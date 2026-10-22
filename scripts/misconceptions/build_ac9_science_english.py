#!/usr/bin/env python3
"""Build the AC9 Science/English misconception tranche.

Written as a generator rather than hand-edited JSON because several records apply
across year levels: the same misconception ("named the device but not its effect")
recurs in the Year 7-10 slices under different topic ids, and duplicating a record
per year would multiply the maintenance and let the wording drift apart.
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

def record(mid, name, topics, description, explanation, signatures):
    return {
        "misconception_id": mid,
        "name": name,
        "description": description,
        "student_facing_explanation": explanation,
        "topic_ids": topics,
        "detection_signatures": signatures,
        "worked_example_ids": [],
        "provenance": APPROVED,
    }


def rx(pattern, notes):
    return {"kind": "regex", "pattern": pattern, "notes": notes}


def pred(name, notes):
    return {"kind": "predicate", "pattern": name, "notes": notes}


RECORDS = [
    # ----------------------------------------------------------------- Science
    record(
        "MC_S7U04_heavier_falls_faster_01",
        "Heavier objects fall faster",
        ["AC9S7U04", "AC9S10U05"],
        "Student states that a heavier object reaches the ground first, treating mass rather than air resistance as the cause of different falling times.",
        "Without air resistance, all objects fall with the same acceleration whatever their mass \u2014 a hammer and a feather land together on the Moon. A feather falls slowly on Earth because of air resistance on its large surface area, not because it is light.",
        [rx(r"(heav\w+|more\s+mass|bigger\s+mass|greater\s+mass)[^.]{0,60}(fall|drop|land|hit)\w*[^.]{0,30}(fast|first|quick|sooner)|(fall|drop)\w*[^.]{0,30}(fast|first|quick)\w*[^.]{0,40}(because|since)[^.]{0,30}(heav|mass|weigh)",
            "Matches the claim in either order; the mass idea and the speed claim must share a clause.")],
    ),
    record(
        "MC_S7U05_particles_expand_when_heated_01",
        "Particles themselves expand when heated",
        ["AC9S7U05", "AC9S8U06"],
        "Student explains thermal expansion by saying the particles get bigger, rather than that they move faster and spread further apart.",
        "Heating never changes the size of a particle. It gives particles more energy so they move faster and sit further apart on average, and that is what makes the substance as a whole expand.",
        [rx(r"(particle|atom|molecule)\w*[^.]{0,40}(get\s+bigger|become\s+bigger|grow|expand|get\s+larger|increase\s+in\s+size|swell)",
            "The particle itself, not the substance, is the subject of the expansion.")],
    ),
    record(
        "MC_S7U06_melting_confused_with_dissolving_01",
        "Melting and dissolving treated as the same change",
        ["AC9S7U06", "AC9S8U06"],
        "Student uses melting to describe a solid disappearing into a liquid, conflating a change of state with the formation of a solution.",
        "Melting needs heat and turns one substance from solid to liquid. Dissolving spreads a solute through a solvent to make a solution and no new substance forms \u2014 sugar dissolves in cold water without melting.",
        [rx(r"melt\w*[^.]{0,30}(in|into)\s+the\s+water|(sugar|salt)[^.]{0,20}melt|melt\w*[^.]{0,20}(dissolv|solution)|dissolv\w*[^.]{0,20}melt",
            "Targets the substitution of melting for dissolving, including 'the salt melted in the water'.")],
    ),
    record(
        "MC_S7U02_energy_recycled_in_food_web_01",
        "Energy recycled through a food web",
        ["AC9S7U02", "AC9S9U03"],
        "Student says energy is recycled or reused around a food web, applying the behaviour of matter to energy.",
        "Matter cycles through an ecosystem but energy does not. Energy enters from the Sun and most of it is lost as heat at each feeding step, which is why food chains are short and each level supports fewer organisms.",
        [rx(r"energy[^.]{0,40}(recycl|re-?used|reused|goes\s+back|returns\s+to\s+the\s+(?:plants|producers)|cycles?\s+(?:around|through))",
            "Energy, not matter, is the subject of the recycling claim.")],
    ),
    record(
        "MC_S7I03_accuracy_confused_with_precision_01",
        "Accuracy and precision treated as interchangeable",
        ["AC9S7I03", "AC9S8I03", "AC9S9I03", "AC9S10I03"],
        "Student equates repeatable measurements with correct ones, or treats extra decimal places as evidence of accuracy.",
        "Precision is how close repeated measurements are to each other; accuracy is how close they are to the true value. A badly calibrated balance can be very precise and wrong every time, and extra decimal places do not make a reading more accurate.",
        [rx(r"(accurate|accuracy)[^.]{0,50}(because|since)[^.]{0,40}(same|similar|close\s+to\s+each\s+other|repeat|consistent|decimal)|(precise|precision)[^.]{0,40}(means|is)[^.]{0,30}(correct|right|true\s+value)",
            "Fires when repeatability or decimal places are offered as the reason a measurement is accurate.")],
    ),
    record(
        "MC_S8U05_energy_used_up_01",
        "Energy is used up rather than transformed",
        ["AC9S8U05", "AC9S9U05"],
        "Student describes energy as being used up, lost or running out, rather than transferred or transformed into another store.",
        "Energy is never used up or created \u2014 it changes store. When a globe 'uses' electrical energy, that energy becomes light and heat. Saying where it went is what earns the mark; 'wasted' energy usually means heat spread into the surroundings.",
        [rx(r"energy[^.]{0,30}(is\s+)?(used\s+up|runs?\s+out|ran\s+out|disappears?|is\s+destroyed|gets?\s+destroyed|vanish)",
            "Distinguished from the acceptable 'lost as heat', which names the destination store.")],
    ),
    record(
        "MC_S8U03_continents_float_on_liquid_mantle_01",
        "Plates floating on a liquid mantle",
        ["AC9S8U03", "AC9S8U04"],
        "Student describes tectonic plates as floating on molten rock or a liquid mantle, rather than moving on solid rock that flows very slowly.",
        "The mantle is solid rock, not liquid. Over very long times it deforms and flows slowly, and that slow movement carries the plates. Magma exists in pockets, not as an ocean under the crust.",
        [rx(r"(plate|continent|crust)\w*[^.]{0,50}(float|sit|rest|slide)\w*[^.]{0,30}(on|over|across)[^.]{0,30}(liquid|molten|magma|lava|melted)|mantle[^.]{0,20}is[^.]{0,15}(liquid|molten|melted)",
            "The claim is about the mantle's state, not simply about plates moving.")],
    ),
    record(
        "MC_S9U04_sound_travels_through_vacuum_01",
        "Sound travelling without a medium",
        ["AC9S9U04"],
        "Student treats sound like light and says it can travel through a vacuum or through space.",
        "Sound is a vibration passed from particle to particle, so it needs a medium. In a vacuum there are no particles to vibrate, which is why space is silent while light still reaches us.",
        [rx(r"\bsound\b(?:(?!\b(?:cannot|can'?t|cant|not|never|no|needs?|requires?|unable)\b)[^.]){0,40}?\b(?:travels?|moves?|goes|be\s+heard)\b[^.]{0,30}?(through\s+(?:a\s+)?vacuum|in\s+space|through\s+space|without\s+(?:a\s+)?(?:medium|air|particles))",
            "No negation may appear between 'sound' and the verb, so a correct denial ('sound cannot travel in space') does not match.")],
    ),
    record(
        "MC_S9U06_irradiated_becomes_radioactive_01",
        "Irradiated objects become radioactive",
        ["AC9S9U06"],
        "Student assumes that anything exposed to radiation becomes radioactive itself, confusing irradiation with contamination.",
        "Irradiation means radiation passed through something; contamination means radioactive material is left on or in it. Irradiated food is not radioactive, in the same way that being lit by a torch does not make you glow.",
        [rx(r"(irradiat\w+|exposed\s+to\s+radiation|been\s+x-?rayed)(?:(?!\b(?:not|no|never|isn'?t|aren'?t|doesn'?t|cannot|won'?t)\b)[^.]){0,50}?\b(becomes?|is|are|will\s+be|makes?\s+it)\b(?:(?!\b(?:not|no|never)\b)[^.]){0,25}?radioactive",
            "No negation may appear before or after the verb, so a correct denial does not match.")],
    ),
    record(
        "MC_S10U05_motion_requires_continuous_force_01",
        "Continuous force needed to keep moving",
        ["AC9S10U05"],
        "Student states that a moving object must have a forward force acting on it, so motion stops when the force is removed.",
        "A force changes motion; it is not needed to maintain it. With no unbalanced force an object keeps moving at constant velocity, and things slow down on Earth because friction and air resistance act, not because the original push ran out.",
        [rx(r"(needs?|requires?|must\s+have|has\s+to\s+have)[^.]{0,30}(a\s+)?(constant|continuous|continual|steady)?\s*force[^.]{0,40}(to\s+keep|to\s+stay|to\s+continue|to\s+remain)[^.]{0,20}(moving|in\s+motion)|(stops?|slows?)[^.]{0,30}because[^.]{0,30}(force|push)[^.]{0,25}(stopped|ran\s+out|used\s+up|gone)",
            "Both orderings of the claim; friction-based explanations are excluded.")],
    ),
    record(
        "MC_S10U02_individuals_evolve_in_lifetime_01",
        "Individuals evolve during their lifetime",
        ["AC9S10U02"],
        "Student describes an individual organism adapting or evolving in response to its environment, and passing that change on.",
        "Individuals do not evolve. Variation already exists in a population; the environment makes some variants more likely to survive and reproduce, so the proportions shift across generations. A giraffe stretching its neck does not lengthen its offspring's neck.",
        [rx(r"(the\s+)?(animal|organism|individual|it|they|giraffe|bird)\w*[^.]{0,40}(evolved|adapted|changed|grew|developed)[^.]{0,40}(so\s+that|in\s+order\s+to|to\s+survive|because\s+it\s+needed)|(needed|wanted)[^.]{0,30}(so|and)[^.]{0,20}(it|they)[^.]{0,20}(evolved|adapted|grew)",
            "Targets purpose-driven change within an individual, not population-level wording.")],
    ),
    record(
        "MC_S10U01_dominant_allele_is_more_common_01",
        "Dominant alleles assumed to be more common",
        ["AC9S10U01"],
        "Student equates dominance with frequency, expecting the dominant allele or phenotype to be the majority in a population.",
        "Dominant describes which allele is expressed when both are present, not how common it is. A dominant allele can be rare \u2014 polydactyly is dominant and uncommon \u2014 so frequency has to come from the data, not from dominance.",
        [rx(r"dominant[^.]{0,40}(more\s+common|most\s+common|majority|more\s+people|more\s+often|usually\s+found|stronger)|(more\s+common|most\s+common)[^.]{0,30}because[^.]{0,20}dominant",
            "Fires on the frequency claim, not on correct expression wording.")],
    ),
    # ----------------------------------------------------------------- English
    record(
        "MC_E7LE02_opinion_without_evidence_01",
        "Judgement about a text with nothing from the text",
        ["AC9E7LE02", "AC9E8LE02", "AC9E9LE02", "AC9E10LE02"],
        "Student states a personal response to a text but cites no quotation, detail or technique to support it.",
        "A response about a text needs something from the text in it. Name the moment, quote a few words, or point to a technique, then say what it makes the reader think or feel. \"I liked it\" tells the reader about you rather than about the writing.",
        [pred("opinion_without_textual_evidence",
              "Requires an opinion cue and the absence of any quotation, named technique or textual reference.")],
    ),
    record(
        "MC_E7LE06_device_named_without_effect_01",
        "Literary device named but its effect not explained",
        ["AC9E7LE06", "AC9E8LE05", "AC9E9LE05", "AC9E10LE05"],
        "Student identifies a technique such as a simile or metaphor and stops there, without saying what it does for the reader.",
        "Naming the technique is only the first half. The mark comes from the effect: what picture, feeling or idea does it create for the reader, and why did the writer want that here?",
        [rx(r"^(?:it\s+(?:is|uses)\s+)?(?:a\s+|an\s+)?(simile|metaphor|personification|alliteration|onomatopoeia|hyperbole|imagery|repetition|symbolism|assonance|sibilance)\.?$",
            "Anchored to the whole answer: the response is the device name and nothing else.")],
    ),
    record(
        "MC_E7LA02_retells_instead_of_analysing_01",
        "Retelling the plot instead of analysing",
        ["AC9E7LA02", "AC9E8LA02", "AC9E9LA02", "AC9E10LA02"],
        "Student summarises what happens in sequence when the question asks how or why the writing works.",
        "Retelling shows you followed the story; analysing shows you understand the writing. Instead of what happens next, write about the choice the author made and its effect \u2014 one moment examined closely beats a summary of everything.",
        [rx(r"\bfirst\b[^.]{0,80}\bthen\b[^.]{0,80}\b(then|next|after\s+that|finally|in\s+the\s+end)\b|^\s*(?:the\s+)?(?:story|text|poem|extract)\s+is\s+about\b",
            "Sequence chaining, or an answer that opens by summarising what the text is about.")],
    ),
    record(
        "MC_E9LA09_quotation_not_integrated_01",
        "Quotation dropped in without marks or integration",
        ["AC9E9LA09", "AC9E10LA09"],
        "Student refers to the writer's exact words without quotation marks, or drops a quotation in as a whole sentence with no lead-in.",
        "A quotation needs marks around the writer's exact words and a lead-in that makes it part of your sentence. Compare \"She is described as \u2018a shadow in the doorway\u2019, which makes her seem\u2026\" with a quotation left standing on its own.",
        [rx(r"(the\s+(?:writer|author|poet)\s+(?:says|writes|states)|quote|quotation)[^\"\u201c']{0,60}$|^\s*[A-Z][^\"\u201c']{15,}\.\s*This\s+(?:shows|means)",
            "Fires when the answer refers to the writer's words with no quotation marks anywhere, or presents an unmarked sentence followed by 'This shows'.")],
    ),
]

def main() -> None:
    destination = _output_path("data/misconceptions/prod/ac9_science_english.json")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8") as handle:
        json.dump({"misconceptions": RECORDS}, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    print(f"wrote {len(RECORDS)} records to {destination}")


if __name__ == "__main__":
    main()
