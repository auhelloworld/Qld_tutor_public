# Imported Exam Papers

Place JSON exam files here. Each file is a complete exam paper that can be selected in the Mock Exam page.

## File format

```json
{
  "title": "Year 7 Maths Term 2 Exam 2024",
  "time_limit_minutes": 60,
  "questions": [
    {
      "id": "exam1_q1",
      "question": "Simplify 24/36",
      "answer": "2/3",
      "question_type": "short_answer",
      "topic_ids": ["AC9M7N04"],
      "difficulty": "foundational"
    },
    {
      "id": "exam1_q2",
      "question": "Which fraction is equivalent to 0.25?",
      "answer": "A",
      "question_type": "multiple_choice",
      "choices": ["A. 1/4", "B. 1/3", "C. 2/5", "D. 3/4"],
      "correct_choice": "A",
      "topic_ids": ["AC9M7N04"],
      "difficulty": "foundational"
    },
    {
      "id": "exam1_q3",
      "question": "A rectangle has length (2x+3) and width (x-1).",
      "answer": "See parts",
      "question_type": "multi_part",
      "sub_parts": [
        {"label": "a", "question": "Write an expression for the perimeter.", "answer": "6x+4", "marks": 1},
        {"label": "b", "question": "If perimeter is 34, find x.", "answer": "5", "marks": 2}
      ],
      "topic_ids": ["AC9M7A02"],
      "difficulty": "extending"
    }
  ]
}
```

## How to create an exam file

1. Scan/photograph a past paper
2. Send to an LLM with this prompt:

```
Convert this exam paper to JSON format:
{
  "title": "exam name",
  "time_limit_minutes": 60,
  "questions": [
    {
      "id": "exam_q1",
      "question": "question text",
      "answer": "correct answer",
      "question_type": "short_answer or multiple_choice or multi_part or reasoning",
      "topic_ids": ["AC9M7xxx"],
      "difficulty": "foundational or developing or extending",
      "choices": [...],  (MCQ only)
      "correct_choice": "A",  (MCQ only)
      "sub_parts": [...],  (multi_part only)
      "rubric": {...}  (reasoning only)
    }
  ]
}
```

3. Save the output as a .json file in this directory
4. It will appear in the Mock Exam page automatically

## Review / fix questions and answers (Bank Review)

Parent Dashboard → **Bank Review**:

1. Open a paper from **data/exams/** (or upload the exam JSON — `{ "questions": [...] }`).
2. Step through items: preview, **Mark** with the intended answer to check keys.
3. Use **Edit question / answer** if something is wrong (steps / rubric points for reasoning; **sub-parts** for multi_part).
4. Click **Save exam → data/exams/** to write the corrected paper back (creates `.bak` if overwriting).

Do **not** use Append for exam QA unless you intentionally want items in the production practice banks (`data/exercise_*.json`). Exam save never touches those bank files.
