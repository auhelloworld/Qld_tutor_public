#!/usr/bin/env python3
"""Worked examples targeting the new senior Maths misconceptions.

These make the misconception-targeted branch of ``_handle_show_worked_example``
reachable for senior Maths: without a worked example naming the misconception, a
student who made a specific error only ever received a generic topic example.

Each one is written to attack the misconception directly rather than to be a
neutral model answer — the second step in every example is where the mistake
would have happened.
"""
import argparse
import json
from pathlib import Path

APPROVED = {
    "source": "hand_curated",
    "approved_by": "batch",
    "approved_at": "2026-07-30T00:00:00+10:00",
    "mined_from_run_id": None,
}

def _output_path(default_relative: str) -> Path:
    """Resolve the output file: ``--out PATH`` if given, else the repository copy."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        help=f"Where to write the JSON (default: {default_relative} inside the repository)",
    )
    args = parser.parse_args()
    if args.out:
        return Path(args.out)
    return Path(__file__).resolve().parents[2] / default_relative

def example(weid, name, topics, framework, question, final, steps, targets):
    return {
        "worked_example_id": weid,
        "name": name,
        "topic_ids": topics,
        "framework": framework,
        "question": question,
        "final_answer": final,
        "steps": [
            {"step_number": i + 1, "prose": prose, "math_latex": latex}
            for i, (prose, latex) in enumerate(steps)
        ],
        "targets_misconception_ids": targets,
        "provenance": APPROVED,
    }


M = "QCAA_SENIOR_MATHS"

EXAMPLES = [
    example(
        "WE_MTH_integration_constant_01",
        "Why an indefinite integral needs + c",
        ["QCAA_METHODS_U3_T4"],
        M,
        "Find $\\int 6x^2 \\, dx$, and explain why the constant matters.",
        "$2x^3 + c$",
        [
            ("Reverse the power rule: raise the index by one and divide by the new index.",
             "\\int 6x^2\\,dx = \\frac{6x^{3}}{3}"),
            ("That gives the antiderivative. Now test whether it is the only one: differentiate $2x^3$, and also $2x^3+7$.",
             "\\frac{d}{dx}(2x^3) = 6x^2 \\quad\\text{and}\\quad \\frac{d}{dx}(2x^3+7) = 6x^2"),
            ("Both differentiate back to the integrand, so infinitely many functions work. The constant records that whole family.",
             "\\int 6x^2\\,dx = 2x^3 + c"),
            ("A definite integral is different: the constants cancel when you subtract, which is why no $+c$ appears there.",
             "\\int_0^1 6x^2\\,dx = [2x^3]_0^1 = 2"),
        ],
        ["MC_MTHU3T4_integration_missing_constant_01"],
    ),
    example(
        "WE_MTH_independent_events_01",
        "And means multiply, or means add",
        ["QCAA_METHODS_U1_T5"],
        M,
        "A component works with probability $0.9$ and, independently, a second works with probability $0.8$. Find the probability that both work.",
        "$0.72$",
        [
            ("Decide which connective the question uses. 'Both' means A and B, not A or B.",
             None),
            ("For independent events, 'and' multiplies.",
             "P(A \\cap B) = P(A)\\times P(B) = 0.9\\times 0.8"),
            ("Compute the product.", "= 0.72"),
            ("Sanity-check by adding instead: $0.9+0.8=1.7$, which is greater than 1 and so cannot be a probability. That check catches the error every time.",
             "0.9+0.8 = 1.7 > 1"),
        ],
        ["MC_MTHU1T5_probability_added_not_multiplied_01"],
    ),
    example(
        "WE_MTH_log_sum_rule_01",
        "There is no rule for the log of a sum",
        ["QCAA_METHODS_U2_T2"],
        M,
        "Is $\\log(a+b) = \\log a + \\log b$? Test it with $a=2$, $b=8$.",
        "No: $\\log(a+b) \\neq \\log a + \\log b$",
        [
            ("Evaluate the left side with the given numbers.",
             "\\log(2+8) = \\log 10 = 1"),
            ("Evaluate the right side.",
             "\\log 2 + \\log 8 \\approx 0.301 + 0.903 = 1.204"),
            ("They differ, so the split is invalid. One counterexample is enough to disprove a claimed identity.",
             "1 \\neq 1.204"),
            ("The rule that does exist turns a product into a sum, which is what the numbers confirm.",
             "\\log(ab) = \\log a + \\log b \\;\\Rightarrow\\; \\log 16 = \\log 2 + \\log 8"),
        ],
        ["MC_MTHU2T2_log_of_sum_split_01"],
    ),
    example(
        "WE_SPE_permutation_combination_01",
        "Does rearranging change the outcome?",
        ["QCAA_SPECIALIST_U1_T1"],
        M,
        "From 5 students, how many different committees of 3 can be formed? How would the answer change if the three roles were president, secretary and treasurer?",
        "$10$ committees; $60$ role assignments",
        [
            ("Ask the deciding question: if the same three people are listed in a different order, is it a different outcome? For a committee, no.",
             None),
            ("Order does not matter, so count selections.",
             "^{5}C_{3} = \\frac{5!}{3!\\,2!} = 10"),
            ("With named roles, swapping two people changes who is president, so order now matters.",
             "^{5}P_{3} = \\frac{5!}{2!} = 60"),
            ("The two answers differ by $3! = 6$, the number of ways to order each selected group. Seeing that factor is a quick way to spot which one you computed.",
             "60 = 10 \\times 3!"),
        ],
        ["MC_SPEU1T1_permutation_combination_confused_01"],
    ),
    example(
        "WE_SPE_i_squared_01",
        "Tracking the i squared sign through an expansion",
        ["QCAA_SPECIALIST_U2_T1"],
        M,
        "Expand and simplify $(3+2i)(1-4i)$.",
        "$11 - 10i$",
        [
            ("Expand all four products first, leaving $i^2$ in place.",
             "(3+2i)(1-4i) = 3 - 12i + 2i - 8i^{2}"),
            ("Now substitute the definition. This is the step where the sign is usually lost.",
             "i^{2} = -1 \\;\\Rightarrow\\; -8i^{2} = -8(-1) = +8"),
            ("Collect real and imaginary parts.",
             "(3+8) + (-12+2)i"),
            ("Simplify. Had $i^2$ been treated as $+1$, the real part would have been $3-8=-5$ instead of $11$ \u2014 a 16 unit error from one sign.",
             "= 11 - 10i"),
        ],
        ["MC_SPEU2T1_i_squared_treated_positive_01"],
    ),
    example(
        "WE_SPE_induction_step_01",
        "What the inductive step is allowed to assume",
        ["QCAA_SPECIALIST_U3_T2"],
        M,
        "Prove by induction that $1+2+\\cdots+n = \\frac{n(n+1)}{2}$ for all positive integers $n$.",
        "True for all $n \\ge 1$",
        [
            ("Base case: check $n=1$ directly.",
             "1 = \\frac{1(2)}{2} = 1"),
            ("Inductive assumption: assume the statement for $n=k$ only. Assuming it for $k+1$ would assume the very thing being proved.",
             "1+2+\\cdots+k = \\frac{k(k+1)}{2}"),
            ("Add the next term to both sides. This *derives* the $k+1$ case rather than assuming it.",
             "1+2+\\cdots+k+(k+1) = \\frac{k(k+1)}{2} + (k+1)"),
            ("Factorise to reach the required form, then conclude.",
             "= \\frac{(k+1)(k+2)}{2}"),
        ],
        ["MC_SPEU3T2_induction_assumes_the_target_01"],
    ),
    example(
        "WE_SPE_confidence_interval_01",
        "What the 95% in a confidence interval refers to",
        ["QCAA_SPECIALIST_U4_T5"],
        M,
        "A sample gives a 95% confidence interval of $(4.1, 5.3)$ for a population mean. Interpret it correctly.",
        "95% of intervals constructed this way contain the population mean; this interval either does or does not.",
        [
            ("Identify what is random. The sample varies from study to study; the population mean is a fixed number.",
             None),
            ("Because the parameter is fixed, it cannot have a 95% chance of being in a range \u2014 the statement would be about a constant.",
             None),
            ("The 95% describes the procedure: repeat the sampling many times, build an interval each time, and about 95% of those intervals capture the true mean.",
             None),
            ("So the defensible interpretation names the method, not the probability of this one interval.",
             None),
        ],
        ["MC_SPEU4T5_confidence_interval_probability_01"],
    ),
]

def main() -> None:
    destination = _output_path("data/misconceptions/worked_examples/qcaa_senior_maths.json")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8") as handle:
        json.dump({"worked_examples": EXAMPLES}, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    print(f"wrote {len(EXAMPLES)} records to {destination}")


if __name__ == "__main__":
    main()
