"""Shared LLM provider selection for runtime and offline ingestion tools."""

from __future__ import annotations

import os

from openai import OpenAI


def get_llm_client() -> tuple[OpenAI | None, str]:
    """Return the configured OpenAI-compatible client and selected model.

    Provider order is intentionally identical to the runtime TutorEngine:
    complete generic ``LLM_*`` configuration, then Gemini, then OpenAI, then
    mock mode. Generic configuration is only selected when all three values are
    non-empty so a partial environment cannot silently receive defaults.
    """
    llm_api_key = os.getenv("LLM_API_KEY")
    llm_base_url = os.getenv("LLM_BASE_URL")
    llm_model = os.getenv("LLM_MODEL")
    gemini_key = os.getenv("GEMINI_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")

    if llm_api_key and llm_base_url and llm_model:
        return OpenAI(api_key=llm_api_key, base_url=llm_base_url), llm_model
    if gemini_key:
        return (
            OpenAI(
                api_key=gemini_key,
                base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
            ),
            "gemini-1.5-flash",
        )
    if openai_key:
        return OpenAI(api_key=openai_key), "gpt-4o-mini"
    return None, "mock-model"
