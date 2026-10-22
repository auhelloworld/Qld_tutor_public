"""Pre-check a writing draft for common spelling, punctuation, and grammar issues.

Results are injected into the LLM prompt to guide assessment focus.
Does NOT replace LLM evaluation — it flags mechanical issues for the LLM to consider.
"""

from __future__ import annotations

import re
from typing import Any

# American -> British/Australian mapping (to catch American spellings)
_US_TO_AU: dict[str, str] = {
    "color": "colour", "favorite": "favourite", "center": "centre",
    "theater": "theatre", "analyze": "analyse", "organize": "organise",
    "recognize": "recognise", "apologize": "apologise", "realize": "realise",
    "defense": "defence", "offense": "offence",
    "traveling": "travelling", "labeled": "labelled", "canceled": "cancelled",
    "modeled": "modelled",
    "judgment": "judgement", "aging": "ageing",
}

_TRANSITION_WORDS = {
    "however", "therefore", "moreover", "furthermore", "nevertheless",
    "consequently", "meanwhile", "subsequently", "nonetheless",
    "notwithstanding", "alternatively", "conversely", "otherwise",
    "accordingly", "hence", "thus", "besides", "indeed",
}

_RUN_ON_INDICATORS = re.compile(
    r'\b(and|but|so|or|yet)\b.*\b(and|but|so|or|yet)\b',
    re.IGNORECASE,
)

_SENTENCE_SPLIT = re.compile(
    r'(?<!et al)(?<!Prof)(?<!e\.g)(?<!i\.e)(?<!Mrs)(?<!Mr)(?<!Dr)(?<!Ms)(?<!Sr)(?<!Jr)(?<!vs)(?<=[.!?])\s+'
)


def _count_syllables(word: str) -> int:
    """Rough syllable count for readability estimation."""
    word = word.lower().strip(".,!?;:'\"")
    if not word:
        return 0
    vowels = "aeiou"
    count = 0
    prev_vowel = False
    for ch in word:
        is_vowel = ch in vowels
        if is_vowel and not prev_vowel:
            count += 1
        prev_vowel = is_vowel
    if word.endswith("e") and count > 1:
        count -= 1
    return max(1, count)


_INFORMAL_MARKERS = {
    "kids", "stuff", "things", "nice", "good", "bad", "heaps", "very", "really",
    "gotta", "gonna", "wanna", "cool", "awesome", "basically", "literally",
}

_FIRST_PERSON_PRONOUNS = {"i", "me", "my", "mine", "we", "us", "our", "ours"}


def precheck_text(text: str) -> dict[str, Any]:
    """Run pre-check analysis on a draft and return findings.

    Returns a dict with keys:
      - sentence_count: int
      - avg_sentence_length: float (words)
      - long_sentences: list[tuple[str, int]]  (snippet, word_count) for sentences > 25 words
      - possible_run_ons: list[str]  (sentence snippets that may be run-on)
      - american_spellings: list[tuple[str, str, int]]  (word, suggestion, position)
      - missing_capitalization: list[str]  (sentences that don't start with capital)
      - no_end_punctuation: list[str]  (sentences missing terminal punctuation)
      - informal_register: list[str] (informal words detected)
      - first_person_count: int (count of first person pronouns)
      - flesch_score: float  (rough readability estimate)
      - summary: str  (human-readable summary for prompt injection)
    """
    findings: dict[str, Any] = {
        "sentence_count": 0,
        "avg_sentence_length": 0.0,
        "long_sentences": [],
        "possible_run_ons": [],
        "american_spellings": [],
        "missing_capitalization": [],
        "no_end_punctuation": [],
        "informal_register": [],
        "first_person_count": 0,
        "flesch_score": 100.0,
    }

    # Split into sentences
    raw_sentences = _SENTENCE_SPLIT.split(text.strip())
    sentences = [s.strip() for s in raw_sentences if s.strip()]
    findings["sentence_count"] = len(sentences)

    words_raw = text.split()
    total_words = len(words_raw)
    findings["avg_sentence_length"] = round(total_words / max(len(sentences), 1), 1)

    # Word-level checks
    for word in words_raw:
        clean = word.strip(".,!?;:'\"").lower()
        if clean in _INFORMAL_MARKERS:
            findings["informal_register"].append(clean)
        if clean in _FIRST_PERSON_PRONOUNS:
            findings["first_person_count"] += 1

    # Per-sentence analysis
    for sent in sentences:
        words = sent.split()
        wc = len(words)

        # Long sentences
        if wc > 30:
            snippet = sent[:80] + ("..." if len(sent) > 80 else "")
            findings["long_sentences"].append((snippet, wc))

        # Run-on indicators
        if _RUN_ON_INDICATORS.search(sent) and wc > 20:
            snippet = sent[:80] + ("..." if len(sent) > 80 else "")
            findings["possible_run_ons"].append(snippet)

        # Missing capitalization
        if sent and sent[0].islower():
            snippet = sent[:60] + ("..." if len(sent) > 60 else "")
            findings["missing_capitalization"].append(snippet)

        # Missing end punctuation (last non-space char)
        stripped = sent.rstrip()
        if stripped and stripped[-1] not in ".!?":
            snippet = stripped[:60] + ("..." if len(stripped) > 60 else "")
            findings["no_end_punctuation"].append(snippet)

    # American spelling check
    for i, word in enumerate(words_raw):
        clean = word.strip(".,!?;:'\"").lower()
        if clean in _US_TO_AU:
            findings["american_spellings"].append(
                (word, _US_TO_AU[clean], i),
            )

    # Readability (simple Flesch-like)
    if total_words > 0:
        syllables = sum(_count_syllables(w) for w in words_raw)
        avg_syllables = syllables / total_words
        if len(sentences) > 0:
            flesch = 206.835 - 1.015 * (total_words / len(sentences)) - 84.6 * avg_syllables
            findings["flesch_score"] = round(max(0, min(100, flesch)), 1)

    # Human-readable summary for prompt injection
    summary_parts: list[str] = []
    if findings["missing_capitalization"]:
        summary_parts.append(
            f"{len(findings['missing_capitalization'])} sentence(s) don't start with a capital letter"
        )
    if findings["no_end_punctuation"]:
        summary_parts.append(
            f"{len(findings['no_end_punctuation'])} sentence(s) missing end punctuation"
        )
    if findings["long_sentences"]:
        summary_parts.append(
            f"{len(findings['long_sentences'])} very long sentence(s) (>{30} words) that may need breaking up"
        )
    if findings["informal_register"]:
        unique_informal = sorted(list(set(findings["informal_register"])))[:3]
        summary_parts.append(
            f"Informal vocabulary detected (e.g., {', '.join(unique_informal)})"
        )
    if findings["first_person_count"] > 0:
        summary_parts.append(
            f"{findings['first_person_count']} instance(s) of first-person pronouns ('I', 'me', etc.)"
        )
    if findings["american_spellings"]:
        summary_parts.append(
            f"{len(findings['american_spellings'])} American spelling(s) detected"
        )

    if summary_parts:
        findings["summary"] = "Pre-check flagged: " + "; ".join(summary_parts) + "."
    else:
        findings["summary"] = ""

    return findings
