"""Misconception coverage for Science, English and senior Maths.

The library previously held records for AC9 Maths only, so two thirds of the bank
had no route to a conceptual explanation — and unlike the LLM paths, this one works
offline, which is exactly when a student most needs it.

Detection style follows the subject. Science and English short answers are prose,
so regex signatures read the student's own wording. Senior Maths answers are values
and expressions, so predicates compare them numerically.

A wrong label teaches the wrong lesson, so each record is tested against realistic
correct answers as well as the misconception.
"""
from __future__ import annotations

import re

import pytest

from backend.misconception_library import get_library
from backend.misconception_predicates import PREDICATE_REGISTRY

SENIOR_IDS = [
    "MC_MTHU3T4_integration_missing_constant_01",
    "MC_MTHU1T5_probability_added_not_multiplied_01",
    "MC_MTHU1T5_complement_confused_01",
    "MC_MTHU1T4_degrees_radians_confused_01",
    "MC_MTHU2T2_log_of_sum_split_01",
    "MC_SPEU1T1_permutation_combination_confused_01",
    "MC_SPEU2T1_i_squared_treated_positive_01",
    "MC_SPEU3T2_induction_assumes_the_target_01",
    "MC_SPEU4T5_confidence_interval_probability_01",
]
SCIENCE_IDS = [
    "MC_S7U04_heavier_falls_faster_01",
    "MC_S7U05_particles_expand_when_heated_01",
    "MC_S7U06_melting_confused_with_dissolving_01",
    "MC_S7U02_energy_recycled_in_food_web_01",
    "MC_S7I03_accuracy_confused_with_precision_01",
    "MC_S8U05_energy_used_up_01",
    "MC_S8U03_continents_float_on_liquid_mantle_01",
    "MC_S9U04_sound_travels_through_vacuum_01",
    "MC_S9U06_irradiated_becomes_radioactive_01",
    "MC_S10U05_motion_requires_continuous_force_01",
    "MC_S10U02_individuals_evolve_in_lifetime_01",
    "MC_S10U01_dominant_allele_is_more_common_01",
]
ENGLISH_IDS = [
    "MC_E7LE02_opinion_without_evidence_01",
    "MC_E7LE06_device_named_without_effect_01",
    "MC_E7LA02_retells_instead_of_analysing_01",
    "MC_E9LA09_quotation_not_integrated_01",
]


def _fires(record, question, student, correct=""):
    for signature in record.detection_signatures:
        if signature.kind == "regex":
            if re.search(signature.pattern, student, re.IGNORECASE):
                return True
        elif signature.kind == "predicate":
            if PREDICATE_REGISTRY[signature.pattern]({"question": question}, student, correct):
                return True
    return False


@pytest.fixture(scope="module")
def library():
    return get_library()


@pytest.mark.parametrize("misconception_id", SENIOR_IDS + SCIENCE_IDS + ENGLISH_IDS)
def test_record_is_loaded_and_detectable(library, misconception_id):
    record = library.misconceptions.get(misconception_id)
    assert record is not None, f"{misconception_id} did not load"
    assert record.detection_signatures, "a record with no signature can never fire"
    for signature in record.detection_signatures:
        if signature.kind == "predicate":
            assert signature.pattern in PREDICATE_REGISTRY
    assert record.student_facing_explanation.strip()


@pytest.mark.parametrize(
    "subject,topic_prefixes",
    [
        ("senior maths", ("QCAA_METHODS_", "QCAA_SPECIALIST_")),
        ("science", ("AC9S7",)),
        ("english", ("AC9E7",)),
    ],
)
def test_each_previously_uncovered_subject_now_has_records(library, subject, topic_prefixes):
    covered = [
        topic_id
        for topic_id in library.by_topic_id
        if topic_id.startswith(topic_prefixes)
    ]
    assert covered, f"{subject} still has no misconception coverage"


# (id, question, answers that show the misconception, answers that must not fire)
CASES = [
    (
        "MC_S7U04_heavier_falls_faster_01",
        "Two balls of different mass are dropped. Which lands first? Explain.",
        [
            "The heavier ball lands first because it has more mass",
            "The bowling ball will fall faster than the feather because it is heavier",
        ],
        [
            "They land at the same time; the feather is slowed by air resistance",
            "Air resistance affects the feather more, so it falls more slowly",
        ],
    ),
    (
        "MC_S7U05_particles_expand_when_heated_01",
        "Explain why a metal bar expands when heated.",
        ["The particles get bigger when heated", "The atoms expand so the bar is longer"],
        [
            "The particles vibrate faster and move further apart, so the bar expands",
            "The bar expands because the spacing between particles increases",
        ],
    ),
    (
        "MC_S7U06_melting_confused_with_dissolving_01",
        "Describe what happens when salt is stirred into water.",
        ["The salt melted in the water", "The sugar melts into the water to make a solution"],
        ["The salt dissolves to form a solution", "The salt spreads through the water as a solute"],
    ),
    (
        "MC_S7U02_energy_recycled_in_food_web_01",
        "Describe how energy moves through a food web.",
        ["The energy is recycled back to the plants", "Energy is reused by the next organism"],
        [
            "Energy enters from the Sun and is lost as heat at each level",
            "Matter cycles but energy is lost as heat",
        ],
    ),
    (
        "MC_S7I03_accuracy_confused_with_precision_01",
        "Were the measurements accurate? Explain.",
        [
            "Yes it is accurate because the readings were all the same",
            "The results are accurate because they repeat closely",
        ],
        [
            "They were precise but not accurate, because the balance was not zeroed",
            "Accurate means close to the true value",
        ],
    ),
    (
        "MC_E7LE06_device_named_without_effect_01",
        "What technique does the poet use in line 3 and what is its effect?",
        ["a simile", "Metaphor.", "personification"],
        [
            "A simile, which makes the storm feel like a living animal",
            "The poet uses a metaphor to suggest the city is a machine",
        ],
    ),
    (
        "MC_E7LA02_retells_instead_of_analysing_01",
        "How does the writer build tension in the extract?",
        [
            "First she hears a noise, then she opens the door, then she screams",
            "The story is about a girl who gets lost",
        ],
        [
            "Short sentences slow the reader down and make the pause feel longer",
            "The writer withholds the cause of the noise, so the reader shares her uncertainty",
        ],
    ),
    (
        "MC_E7LE02_opinion_without_evidence_01",
        "What do you think of the main character in the story?",
        ["I think she is boring and the story is bad", "In my opinion it is a great character"],
        [
            'I think she is lonely because she "never speaks first"',
            "I feel sympathy for her when the writer describes her empty room",
        ],
    ),
    (
        "MC_S8U05_energy_used_up_01",
        "Explain the energy changes in a light globe.",
        ["The electrical energy is used up by the globe", "The energy runs out after a while"],
        [
            "The electrical energy is transformed into light and heat",
            "Some energy is lost as heat to the surroundings",
        ],
    ),
    (
        "MC_S8U03_continents_float_on_liquid_mantle_01",
        "Explain how tectonic plates move.",
        ["The plates float on the liquid mantle", "The mantle is liquid so the plates drift"],
        [
            "The plates move because the solid mantle flows very slowly by convection",
            "Convection in the solid mantle drags the plates",
        ],
    ),
    (
        "MC_S9U04_sound_travels_through_vacuum_01",
        "Can sound travel through space? Explain.",
        ["Sound travels through a vacuum", "Sound can be heard in space"],
        [
            "Sound cannot travel in space because there are no particles to vibrate",
            "Sound needs a medium, so space is silent",
        ],
    ),
    (
        "MC_S9U06_irradiated_becomes_radioactive_01",
        "Is irradiated food radioactive? Explain.",
        ["Irradiated food becomes radioactive", "Food exposed to radiation is radioactive"],
        [
            "Irradiation leaves no radioactive material, so the food is not radioactive",
            "Contamination would make it radioactive, but irradiation does not",
        ],
    ),
    (
        "MC_S10U05_motion_requires_continuous_force_01",
        "A puck slides on frictionless ice. Explain its motion.",
        ["It needs a constant force to keep moving", "The puck stops because the push ran out"],
        [
            "With no unbalanced force it keeps moving at constant velocity",
            "It slows on normal ice because friction acts on it",
        ],
    ),
    (
        "MC_S10U02_individuals_evolve_in_lifetime_01",
        "Explain how the population changed over generations.",
        ["The giraffe adapted so that it could reach the leaves", "The animal evolved to survive the cold"],
        [
            "Variation already existed, and individuals with longer necks reproduced more",
            "The proportion of long-necked individuals rose across generations",
        ],
    ),
    (
        "MC_S10U01_dominant_allele_is_more_common_01",
        "Is the dominant allele the most common? Explain.",
        ["The dominant allele is more common in the population", "It is most common because it is dominant"],
        [
            "Dominance describes expression, not frequency; the data show it is rare",
            "A dominant allele can be uncommon",
        ],
    ),
    (
        "MC_E9LA09_quotation_not_integrated_01",
        "How does the writer present the character? Use evidence.",
        [
            "The writer says she was a shadow in the doorway",
            "She was a shadow in the doorway and never spoke. This shows she is isolated",
        ],
        [
            'She is described as "a shadow in the doorway", which makes her seem insubstantial',
            'The phrase "never speaks first" suggests reluctance',
        ],
    ),
]


@pytest.mark.parametrize("misconception_id,question,hits,misses", CASES)
def test_signature_detects_the_misconception(library, misconception_id, question, hits, misses):
    record = library.misconceptions[misconception_id]
    for answer in hits:
        assert _fires(record, question, answer), answer


@pytest.mark.parametrize("misconception_id,question,hits,misses", CASES)
def test_signature_is_silent_on_a_sound_answer(library, misconception_id, question, hits, misses):
    record = library.misconceptions[misconception_id]
    for answer in misses:
        assert not _fires(record, question, answer), f"mislabelled a sound answer: {answer}"


SENIOR_CASES = [
    (
        "MC_MTHU3T4_integration_missing_constant_01",
        "Find the indefinite integral of 2x.",
        "x^2",
        "x^2 + C",
    ),
    (
        "MC_MTHU1T5_probability_added_not_multiplied_01",
        "Two independent events have probability 0.4 and 0.5. Find the probability both occur.",
        "0.9",
        "0.2",
    ),
    (
        "MC_MTHU1T5_complement_confused_01",
        "Find the probability that it does not rain.",
        "0.3",
        "0.7",
    ),
    (
        "MC_MTHU1T4_degrees_radians_confused_01",
        "Give the angle in radians.",
        "57.2958",
        "1",
    ),
    (
        "MC_MTHU2T2_log_of_sum_split_01",
        "Simplify log(x + y).",
        "log(x) + log(y)",
        "log(x + y)",
    ),
    (
        "MC_SPEU1T1_permutation_combination_confused_01",
        "From 5 people, how many selections of 3 are possible?",
        "60",
        "10",
    ),
    (
        "MC_SPEU2T1_i_squared_treated_positive_01",
        "Simplify i squared.",
        "1",
        "-1",
    ),
    (
        "MC_SPEU3T2_induction_assumes_the_target_01",
        "Prove the identity by induction.",
        "Assume it is true for n = k + 1",
        "Assume true for n = k, then derive the result for n = k + 1",
    ),
    (
        "MC_SPEU4T5_confidence_interval_probability_01",
        "Interpret the 95% confidence interval.",
        "There is a 95% chance the population mean is in this interval",
        "About 95% of intervals built this way would contain the population mean",
    ),
]


@pytest.mark.parametrize("misconception_id,question,wrong,correct", SENIOR_CASES)
def test_senior_maths_signature_detects_the_misconception(
    library, misconception_id, question, wrong, correct
):
    record = library.misconceptions[misconception_id]
    assert _fires(record, question, wrong, correct)


@pytest.mark.parametrize("misconception_id,question,wrong,correct", SENIOR_CASES)
def test_senior_maths_signature_is_silent_on_the_correct_answer(
    library, misconception_id, question, wrong, correct
):
    record = library.misconceptions[misconception_id]
    assert not _fires(record, question, correct, correct)


def test_end_to_end_detection_through_the_library(library):
    """detect() must resolve the record from the item's topic_ids."""
    question = {
        "id": "q",
        "question": "Explain why a metal bar expands when heated.",
        "answer": "The particles move further apart.",
        "topic_ids": ["AC9S7U05"],
        "subject": "science",
        "question_type": "short_answer",
    }
    detected = library.detect(
        topic_ids=["AC9S7U05"],
        question=question,
        student_answer="The particles get bigger when heated",
        correct_answer=question["answer"],
    )
    assert detected == "MC_S7U05_particles_expand_when_heated_01"
    assert (
        library.detect(
            topic_ids=["AC9S7U05"],
            question=question,
            student_answer="They vibrate faster and move further apart",
            correct_answer=question["answer"],
        )
        is None
    )


def test_every_exercise_bank_has_some_misconception_coverage(library):
    """Coverage was AC9 Maths only, leaving two thirds of the bank with no route
    to a conceptual explanation — and this path is the one that works offline.
    """
    import glob
    import json
    import re

    uncovered = []
    for path in sorted(glob.glob("data/exercise_*.json")):
        covered = 0
        for item in json.load(open(path, encoding="utf-8")):
            if not isinstance(item, dict) or item.get("status") == "draft":
                continue
            if any(topic in library.by_topic_id for topic in (item.get("topic_ids") or [])):
                covered += 1
        if covered == 0:
            uncovered.append(re.sub(r"data/exercise_|\.json", "", path))
    assert uncovered == [], f"banks with no misconception coverage: {uncovered}"


class TestTargetedWorkedExamplesAreReachable:
    """A worked example keyed to a misconception is only usable if that
    misconception can be detected and the example is indexed against it.
    """

    SENIOR_WORKED_EXAMPLES = [
        ("WE_MTH_integration_constant_01", "MC_MTHU3T4_integration_missing_constant_01"),
        ("WE_MTH_independent_events_01", "MC_MTHU1T5_probability_added_not_multiplied_01"),
        ("WE_MTH_log_sum_rule_01", "MC_MTHU2T2_log_of_sum_split_01"),
        ("WE_SPE_permutation_combination_01", "MC_SPEU1T1_permutation_combination_confused_01"),
        ("WE_SPE_i_squared_01", "MC_SPEU2T1_i_squared_treated_positive_01"),
        ("WE_SPE_induction_step_01", "MC_SPEU3T2_induction_assumes_the_target_01"),
        ("WE_SPE_confidence_interval_01", "MC_SPEU4T5_confidence_interval_probability_01"),
    ]

    @pytest.mark.parametrize("worked_example_id,misconception_id", SENIOR_WORKED_EXAMPLES)
    def test_example_is_indexed_against_its_misconception(
        self, library, worked_example_id, misconception_id
    ):
        assert worked_example_id in library.worked_examples
        indexed = {
            example.worked_example_id
            for example in library.we_by_misconception.get(misconception_id, [])
        }
        assert worked_example_id in indexed

    @pytest.mark.parametrize("worked_example_id,misconception_id", SENIOR_WORKED_EXAMPLES)
    def test_the_targeted_misconception_is_detectable(
        self, library, worked_example_id, misconception_id
    ):
        record = library.misconceptions[misconception_id]
        assert any(
            signature.kind != "predicate" or signature.pattern in PREDICATE_REGISTRY
            for signature in record.detection_signatures
        )

    @pytest.mark.parametrize("worked_example_id,misconception_id", SENIOR_WORKED_EXAMPLES)
    def test_example_has_usable_steps(self, library, worked_example_id, misconception_id):
        example = library.worked_examples[worked_example_id]
        assert len(example.steps) >= 3
        assert example.final_answer.strip()
        assert all(step.prose.strip() for step in example.steps)

    def test_no_worked_example_targets_a_missing_misconception(self, library):
        orphans = [
            misconception_id
            for misconception_id in library.we_by_misconception
            if misconception_id not in library.misconceptions
        ]
        assert orphans == []
