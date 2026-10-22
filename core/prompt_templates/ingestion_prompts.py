SYLLABUS_INGESTION_PROMPT = """
You are an expert curriculum designer. Your task is to extract learning topics and skills from the raw educational syllabus text provided below.

Raw Text:
{raw_text}

Rules:
1. Extract distinct mathematical topics.
2. Formulate a 'concept_card' for each topic detailing its core mathematical rule and pedagogical hint strategies.
3. CRITICAL: For EVERY topic extracted, you MUST provide the 'source_ref', which is the VERBATIM sentence or paragraph from the raw text that justifies this topic's inclusion. Do not paraphrase the source_ref.
4. Output strict JSON matching the provided schema.
"""

EXERCISE_INGESTION_PROMPT = """
You are an expert math tutor. Your task is to extract distinct math problems from the raw unstructured text provided below.

Raw Text:
{raw_text}

Rules:
1. Extract each distinct mathematical question.
2. Determine the core topic (e.g., 'fractions', 'integers').
3. Extract or compute the final numerical/algebraic answer.
4. If steps are provided in the text, extract them. If not, generate a brief step-by-step solution.
5. IMPORTANT: If the raw text contains image tags like [插图: filename.png] or [图: abc.jpg], convert them precisely to standard Markdown image syntax: ![图](/images/filename.png).
6. Output strict JSON matching the provided schema.
"""
