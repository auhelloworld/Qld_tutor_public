"""Backend identity gate — validates the cryptographically secure JWT bearer tokens on affected endpoints.

Design §3.3; Requirements 3.1, 3.2, 3.3.
"""

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import time

from fastapi import Header, HTTPException, Request

logger = logging.getLogger(__name__)

# --- Constants (Task 3.1) ---

UUID_V4_PATTERN = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    re.IGNORECASE,
)

STUDENT_ID_HEADER = 'X-Student-Id'

# Security key: require JWT_SECRET in production; generate a random fallback
# for local development so that tokens still work (but are invalidated on restart).
_jwt_secret_env = os.getenv("JWT_SECRET", "")
if _jwt_secret_env:
    JWT_SECRET = _jwt_secret_env
else:
    JWT_SECRET = secrets.token_hex(32)
    logger.warning(
        "JWT_SECRET is not set — using a random ephemeral secret. "
        "Set JWT_SECRET in production to persist tokens across restarts."
    )


# --- Cryptographic Helper Functions for JWT ---

def base64url_encode(data: bytes) -> str:
    """Encode bytes to base64url string with no padding."""
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('utf-8')


def base64url_decode(data: str) -> bytes:
    """Decode base64url string back to bytes after restoring padding."""
    padding = '=' * (4 - len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def encode_jwt(payload: dict, secret: str = JWT_SECRET) -> str:
    """Encode header and payload into a signed base64url JWT token."""
    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = base64url_encode(json.dumps(header, separators=(',', ':')).encode('utf-8'))
    payload_b64 = base64url_encode(json.dumps(payload, separators=(',', ':')).encode('utf-8'))
    
    signing_input = f"{header_b64}.{payload_b64}".encode('utf-8')
    signature = hmac.new(secret.encode('utf-8'), signing_input, hashlib.sha256).digest()
    signature_b64 = base64url_encode(signature)
    
    return f"{header_b64}.{payload_b64}.{signature_b64}"


def decode_jwt(token: str, secret: str = JWT_SECRET) -> dict:
    """Decode and cryptographically verify a base64url JWT token."""
    try:
        parts = token.split('.')
        if len(parts) != 3:
            raise ValueError("Token must have 3 parts separated by dots")
        
        header_b64, payload_b64, signature_b64 = parts
        signing_input = f"{header_b64}.{payload_b64}".encode('utf-8')
        
        # Verify HMAC-SHA256 signature
        expected_signature = hmac.new(secret.encode('utf-8'), signing_input, hashlib.sha256).digest()
        expected_signature_b64 = base64url_encode(expected_signature)
        
        if not hmac.compare_digest(signature_b64, expected_signature_b64):
            raise ValueError("Signature validation failed")
        
        payload_bytes = base64url_decode(payload_b64)
        payload = json.loads(payload_bytes.decode('utf-8'))
        
        # Check expiration claim
        if "exp" in payload and time.time() > payload["exp"]:
            raise ValueError("Token has expired")
            
        return payload
    except Exception as e:
        raise ValueError(str(e))


def create_student_token(student_id: str, expires_in_seconds: int = 30 * 86400) -> str:
    """Create a signed JWT token for a given student ID (UUID v4)."""
    if not UUID_V4_PATTERN.match(student_id):
        raise ValueError(f"'{student_id}' is not a valid UUID v4")
    
    payload = {
        "sub": student_id,
        "iat": int(time.time()),
        "exp": int(time.time()) + expires_in_seconds,
    }
    return encode_jwt(payload)


# --- Parent authorization (server-side secret, distinct from student token) ---

PARENT_TOKEN_HEADER = "X-Parent-Token"


def get_parent_password() -> str | None:
    """Return the configured server-side parent password.

    Parent access is disabled when ``PARENT_PASSWORD`` is missing or empty.
    A built-in default would turn a deployment omission into a known password,
    so callers must handle ``None`` as a configuration error.
    """
    password = os.getenv("PARENT_PASSWORD")
    return password if password else None


def create_parent_token(student_id: str, expires_in_seconds: int = 2 * 3600) -> str:
    """Create a parent token bound to one validated student identity.

    The browser also locks parent pages after 15 minutes without input; this
    short server lifetime limits a token that is left in a shared tab.
    """
    if not UUID_V4_PATTERN.match(student_id):
        raise ValueError(f"'{student_id}' is not a valid UUID v4")
    payload = {
        "role": "parent",
        "sub": student_id,
        "iat": int(time.time()),
        "exp": int(time.time()) + expires_in_seconds,
    }
    return encode_jwt(payload)


# --- Exception classes (Task 3.2) ---


class StudentIdMissing(HTTPException):
    """Raised when the session/token is absent on an affected endpoint."""

    def __init__(self, endpoint: str):
        super().__init__(
            status_code=401,
            detail={
                "error": "missing_student_id",
                "message": f"Bearer session token is required via Authorization or {STUDENT_ID_HEADER}",
                "endpoint": endpoint,
            },
        )


class StudentIdInvalid(HTTPException):
    """Raised when the session token fails cryptographic validation."""

    def __init__(self, endpoint: str, value: str):
        super().__init__(
            status_code=401,
            detail={
                "error": "invalid_student_id",
                "message": f"Provided session token is invalid, corrupted, or expired: {value}",
                "endpoint": endpoint,
            },
        )


# --- FastAPI dependency (Task 3.3) ---


async def require_student_id(
    request: Request,
    authorization: str | None = Header(None, alias="Authorization"),
    x_student_id: str | None = Header(None, alias="X-Student-Id"),
) -> str:
    """Extract and validate the bearer JWT token.

    Returns the validated student ID (UUID v4) on success.
    Raises StudentIdMissing (400) if no token is found.
    Raises StudentIdInvalid (400) if the token fails validation.
    """
    endpoint = request.url.path
    token = None

    # 1. Try standard Authorization header
    if isinstance(authorization, str):
        if authorization.lower().startswith("bearer "):
            token = authorization[7:].strip()
        elif re.match(r'^(Basic|Digest|Hawk|AWS4-HMAC|Negotiate|NTLM)\s', authorization, re.IGNORECASE):
            # Reject known non-Bearer authentication schemes explicitly
            raise StudentIdInvalid(endpoint, authorization[:20] + "...")
        else:
            # Allow raw token (no scheme prefix) for backward compatibility
            token = authorization.strip()

    # 2. Fall back to custom X-Student-Id header if Authorization is missing
    elif isinstance(x_student_id, str):
        if x_student_id.lower().startswith("bearer "):
            token = x_student_id[7:].strip()
        else:
            token = x_student_id.strip()

    if not token:
        raise StudentIdMissing(endpoint)

    # 3. Try JWT decode; fall back to raw UUID for backward compatibility
    if UUID_V4_PATTERN.match(token):
        return token
    try:
        payload = decode_jwt(token)
        student_id = payload.get("sub")
        if not student_id or not UUID_V4_PATTERN.match(student_id):
            raise ValueError("Token sub claim must be a valid UUID v4")
        return student_id
    except Exception as e:
        raise StudentIdInvalid(endpoint, token)


async def require_parent(
    request: Request,
    x_parent_token: str | None = Header(None, alias=PARENT_TOKEN_HEADER),
) -> str:
    """Validate a parent token and return its bound student identity.

    The token is distinct from the student token, server-signed, and minted
    only after a server-side password check. Parent routes must additionally
    compare this returned identity with the active student and request target.
    """
    endpoint = request.url.path
    token = (x_parent_token or "").strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    if not token:
        raise HTTPException(
            status_code=401,
            detail={
                "error": "parent_auth_required",
                "message": "Parent authorization is required for this action.",
                "endpoint": endpoint,
            },
        )
    try:
        payload = decode_jwt(token)
        if payload.get("role") != "parent":
            raise ValueError("token is not a parent token")
        student_id = payload.get("sub")
        if not isinstance(student_id, str) or not UUID_V4_PATTERN.match(student_id):
            raise ValueError("parent token is not bound to a valid student")
        return student_id
    except Exception:
        raise HTTPException(
            status_code=401,
            detail={
                "error": "parent_auth_invalid",
                "message": "Parent session is invalid or expired. Please unlock the dashboard again.",
                "endpoint": endpoint,
            },
        )


def ensure_parent_student_access(
    caller_student_id: str,
    parent_student_id: str,
    target_student_id: str | None = None,
) -> str:
    """Require student session, parent session and requested target to agree."""
    target = target_student_id or caller_student_id
    if caller_student_id != parent_student_id or target != caller_student_id:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "student_scope_mismatch",
                "message": "This parent session is not authorized for the requested student.",
            },
        )
    return target
