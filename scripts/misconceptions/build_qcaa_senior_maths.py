#!/usr/bin/env python3
"""Build the QCAA senior Maths misconception tranche (Methods + Specialist)."""
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

def record(mid, name, topics, description, explanation, signatures, worked=None):
    return {
        "misconception_id": mid,
        "name": name,
        "description": description,
        "student_facing_explanation": explanation,
        "topic_ids": topics,
        "detection_signatures": signatures,
        "worked_example_ids": worked or [],
        "provenance": APPROVED,
    }


def pred(name, notes):
    return {"kind": "predicate", "pattern": name, "notes": notes}


def rx(pattern, notes):
    return {"kind": "regex", "pattern": pattern, "notes": notes}


RECORDS = [
    record(
        "MC_MTHU3T4_integration_missing_constant_01",
        "Indefinite integral written without the constant",
        ["QCAA_METHODS_U3_T4", "QCAA_SPECIALIST_U4_T1"],
        "Student produces the correct antiderivative but omits the arbitrary constant, treating an indefinite integral as if it had a single value.",
        "An indefinite integral has infinitely many answers, because any constant differentiates to zero. Your antiderivative is right \u2014 finish it with $+c$ to show the whole family of functions.",
        [pred("integration_missing_constant",
              "Only fires when the authored answer carries a constant and the rest of the expression matches, so definite integrals and other errors are excluded.")],
        ["WE_MTH_integration_constant_01"],
    ),
    record(
        "MC_MTHU1T5_probability_added_not_multiplied_01",
        "Adding probabilities of independent events",
        ["QCAA_METHODS_U1_T5"],
        "Student adds the probabilities of two independent events when asked for the probability that both occur, instead of multiplying them.",
        "Adding probabilities answers \"one or the other\". For both events you multiply: $P(A \\text{ and } B) = P(A) \\times P(B)$ when the events are independent. Adding can also give a value above 1, which is a useful check.",
        [pred("probability_added_instead_of_multiplied",
              "Requires the student's value to equal the sum and the authored answer the product of two probabilities in the question.")],
        ["WE_MTH_independent_events_01"],
    ),
    record(
        "MC_MTHU1T5_complement_confused_01",
        "Reporting the complement instead of the probability asked for",
        ["QCAA_METHODS_U1_T5"],
        "Student computes the probability of the opposite event, typically missing a 'not', 'at least' or 'fails' in the question.",
        "Your value is $1$ minus the answer, so the working is sound but it answers the opposite event. Re-read what is asked, then convert with $P(\\text{not } A) = 1 - P(A)$.",
        [pred("complement_probability_confused",
              "Both values must lie in [0,1] and sum to 1; 0.5 is excluded as indistinguishable from its own complement.")],
    ),
    record(
        "MC_MTHU1T4_degrees_radians_confused_01",
        "Working in degrees where radians are required",
        ["QCAA_METHODS_U1_T4", "QCAA_SPECIALIST_U2_T4"],
        "Student evaluates or reports an angle in the wrong angular unit, so the answer differs from the correct one by a factor of 180/pi.",
        "Your number is the same angle in the other unit. Calculus and the unit circle use radians, where a full turn is $2\\pi$ rather than $360°$. Convert with $\\text{radians} = \\text{degrees} \\times \\frac{\\pi}{180}$, and check your calculator's mode.",
        [pred("degrees_radians_confused",
              "Requires the student's value to equal the authored value scaled by exactly 180/pi or pi/180.")],
    ),
    record(
        "MC_MTHU2T2_log_of_sum_split_01",
        "Log of a sum split into a sum of logs",
        ["QCAA_METHODS_U2_T2"],
        "Student rewrites log(a + b) as log(a) + log(b), applying the product rule to a sum.",
        "The product rule turns a *product* into a sum of logs: $\\log(ab) = \\log a + \\log b$. There is no rule that splits $\\log(a+b)$ \u2014 test it with numbers: $\\log(2+8) = \\log 10 = 1$, but $\\log 2 + \\log 8 \\approx 1.2$.",
        [pred("log_of_sum_split",
              "Checked symbolically: the student's expression must equal the sum of the logs of the authored argument's terms, and that argument must be a sum.")],
        ["WE_MTH_log_sum_rule_01"],
    ),
    record(
        "MC_SPEU1T1_permutation_combination_confused_01",
        "Counting arrangements when selections were asked for",
        ["QCAA_SPECIALIST_U1_T1"],
        "Student uses nPr where nCr is required (or the reverse), so order is counted when it does not matter, or ignored when it does.",
        "Your value counts the other kind of outcome. Ask whether rearranging the same items gives a different result: if it does, order matters and you want $^nP_r$; if not, $^nC_r$. They differ by exactly $r!$, the number of ways to order each selection.",
        [pred("permutation_combination_confused",
              "Confirms the student's value is nPr and the authored value nCr for some n and r in the question, or the reverse.")],
        ["WE_SPE_permutation_combination_01"],
    ),
    record(
        "MC_SPEU2T1_i_squared_treated_positive_01",
        "Treating i squared as positive one",
        ["QCAA_SPECIALIST_U2_T1", "QCAA_SPECIALIST_U3_T1"],
        "Student simplifies a complex expression as though i squared were +1, so a negative result is reported with the wrong sign.",
        "By definition $i^2 = -1$, not $+1$. That single sign propagates through the whole expansion, so check every place an $i \\times i$ appears before collecting like terms.",
        [pred("negative_squared",
              "The authored answer is negative and the student gives its positive counterpart, the signature of losing the i-squared sign.")],
        ["WE_SPE_i_squared_01"],
    ),
    record(
        "MC_SPEU3T2_induction_assumes_the_target_01",
        "Induction step assumes what it is meant to prove",
        ["QCAA_SPECIALIST_U3_T2"],
        "Student writes the inductive step by assuming the statement for n = k + 1, which is the very claim being proved, so the argument is circular.",
        "The inductive step assumes the statement for $n = k$ and then *derives* it for $n = k + 1$. Assuming it for $k+1$ assumes what you are trying to show. Write the assumption for $k$, then substitute and manipulate until the $k+1$ form appears.",
        [rx(r"(?:assum\w+|suppose|let)(?:(?!n\s*=\s*k\b(?!\s*\+))[^.]){0,40}?n\s*=\s*k\s*\+\s*1",
            "The gap may not contain a bare 'n = k', so a correct step that assumes k and then derives k+1 does not match.")],
        ["WE_SPE_induction_step_01"],
    ),
    record(
        "MC_SPEU4T5_confidence_interval_probability_01",
        "Confidence interval read as a probability about the parameter",
        ["QCAA_SPECIALIST_U4_T5"],
        "Student interprets a 95% confidence interval as a 95% probability that the population parameter lies inside this particular interval.",
        "The population value is fixed, not random, so it does not have a 95% chance of being anywhere. The 95% describes the *method*: if many samples were taken and an interval built each time, about 95% of those intervals would contain the true value. This one either does or does not.",
        [rx(r"(95|90|99)\s*%?[^.]{0,40}(chance|probability|likely|likelihood)[^.]{0,40}(the\s+)?(population|true|actual)?\s*(mean|proportion|parameter|value)[^.]{0,30}(is|lies|falls|within|in|between)|(probability|chance)[^.]{0,30}(that\s+)?the\s+(population|true)\s+(mean|proportion)[^.]{0,20}(is|lies|falls)",
            "Fires on a probability claim about the parameter, not on the correct long-run statement about intervals.")],
        ["WE_SPE_confidence_interval_01"],
    ),
]

def main() -> None:
    destination = _output_path("data/misconceptions/prod/qcaa_senior_maths.json")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8") as handle:
        json.dump({"misconceptions": RECORDS}, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    print(f"wrote {len(RECORDS)} records to {destination}")


if __name__ == "__main__":
    main()
