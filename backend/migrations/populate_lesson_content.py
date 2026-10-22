#!/usr/bin/env python3
import json
import os
import sys

# Ensure the backend directory is in python path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.schema.curriculum_schema import FrameworkSliceFile

# Define Year 7 lesson contents according to lesson_content_prompt.md guidelines
LESSON_CONTENTS = {
    "AC9M7N02": {
        "prerequisite_topics": [],
        "learning_objectives": [
            "Identify prime and composite numbers up to 100.",
            "Find the prime factors of any natural number using factor trees.",
            "Write prime factorisations using exponent notation."
        ],
        "explanation_sections": [
            {
                "heading": "What are Prime Numbers?",
                "body": "A prime number is a whole number greater than one. It has exactly two factors: one and itself. For example, 2, 3, 5, and 7 are prime. Numbers with more than two factors, like 6 or 9, are called composite numbers. Think of prime numbers as the basic building blocks of all whole numbers.",
                "type": "concept"
            },
            {
                "heading": "The Factor Tree Method",
                "body": "To find the prime factors of a number, we can use a factor tree. First, split the number into any two factors. Next, if either factor is not prime, split it again. Repeat this until you only have prime numbers at the ends of your branches. Circle these prime numbers as you find them.",
                "type": "method"
            },
            {
                "heading": "Using Exponent Notation",
                "body": "Once we find all the prime factors, we write them in order from smallest to largest. If a prime factor appears more than once, we use exponent notation. For example, if we have three 2s and one 3, we write this as 2 cubed multiplied by 3, which is 2³ × 3.",
                "type": "method"
            },
            {
                "heading": "Worked Example: Factorising 36",
                "body": "Let us find the prime factorisation of 36. Split 36 into 6 × 6. Since 6 is composite, split each 6 into 2 × 3. Now we have the prime numbers 2, 3, 2, and 3. We group these together: two 2s and two 3s. Written in exponent notation, 36 is 2² × 3².",
                "type": "example"
            },
            {
                "heading": "Common Pitfall: The Number 1",
                "body": "Remember that the number 1 is not a prime number. It is also not a composite number. Do not include 1 in your prime factor trees or factorisation results. The smallest prime number is 2.",
                "type": "warning"
            }
        ],
        "key_vocabulary": [
            {"term": "prime number", "definition": "A whole number greater than 1 that only has factors of 1 and itself."},
            {"term": "composite number", "definition": "A whole number that has more than two factors."},
            {"term": "exponent notation", "definition": "A shorthand way to write repeated multiplication using base numbers and powers."},
            {"term": "prime factorisation", "definition": "Writing a composite number as a product of its prime factors."}
        ],
        "common_mistakes": [
            "Including the number 1 as a prime factor in the final product.",
            "Adding the prime factors together instead of multiplying them.",
            "Writing the exponents in the wrong position or multiplying the base by the exponent."
        ],
        "real_world_connections": [
            "Prime factorisation is used in computer security and cryptography to encrypt messages and protect online bank transactions.",
            "Cicadas use prime number cycles (like 13 or 17 years) to emerge from the ground and avoid predators."
        ],
        "additional_worked_examples": [
            {
                "question": "Find the prime factorisation of 24 in exponent notation.",
                "answer": "2³ × 3",
                "steps": [
                    {"step": 1, "instruction": "Split 24 into two factors, such as 4 and 6.", "result": "24 = 4 × 6"},
                    {"step": 2, "instruction": "Split the composite number 4 into 2 × 2, and 6 into 2 × 3.", "result": "Prime factors found: 2, 2, 2, 3"},
                    {"step": 3, "instruction": "Group the repeated prime factors and write using exponent notation.", "result": "2³ × 3"}
                ]
            },
            {
                "question": "Find the prime factorisation of 90 in exponent notation.",
                "answer": "2 × 3² × 5",
                "steps": [
                    {"step": 1, "instruction": "Split 90 into two factors, such as 9 and 10.", "result": "90 = 9 × 10"},
                    {"step": 2, "instruction": "Split 9 into 3 × 3, and 10 into 2 × 5.", "result": "Prime factors found: 3, 3, 2, 5"},
                    {"step": 3, "instruction": "Arrange factors from smallest to largest and group repeated primes.", "result": "2 × 3² × 5"}
                ]
            }
        ],
        "external_resources": []
    },
    "AC9M7N03": {
        "prerequisite_topics": [],
        "learning_objectives": [
            "Identify the place value of any digit in a natural number.",
            "Write powers of 10 using exponent notation.",
            "Express natural numbers in expanded notation using place value and powers of 10."
        ],
        "explanation_sections": [
            {
                "heading": "Understanding Place Value",
                "body": "In our number system, the value of a digit depends on its position. This is called place value. For example, in the number 450, the digit 4 represents four hundreds, which is 400. Each place to the left is ten times larger than the place to its right.",
                "type": "concept"
            },
            {
                "heading": "Powers of 10 as Exponents",
                "body": "We can write place values like 10, 100, and 1000 using powers of ten. The exponent tells us how many tens we multiply together, which is also the number of zeros. So, 10 is 10¹, 100 is 10², and 1000 is 10³. The units column (1) is written as 10⁰.",
                "type": "method"
            },
            {
                "heading": "Writing in Expanded Notation",
                "body": "To write a number in expanded notation, multiply each digit by its place value written as a power of ten. Then, write these parts as a sum. For example, 352 is three hundreds, five tens, and two ones. We write this as (3 × 10²) + (5 × 10¹) + (2 × 10⁰).",
                "type": "method"
            },
            {
                "heading": "Worked Example: Expanding 4,085",
                "body": "Let us write 4,085 in expanded notation. The digit 4 is in the thousands place (10³). The 0 is in the hundreds place (10²). The 8 is in the tens place (10¹). The 5 is in the ones place (10⁰). We write: (4 × 10³) + (0 × 10²) + (8 × 10¹) + (5 × 10⁰).",
                "type": "example"
            },
            {
                "heading": "Common Pitfall: The Digit Zero",
                "body": "When a number contains a zero, do not skip its place value position. While you can omit it in simple sums, in strict power-of-ten expanded notation we include it as 0 multiplied by that power, such as 0 × 10².",
                "type": "warning"
            }
        ],
        "key_vocabulary": [
            {"term": "place value", "definition": "The value of a digit based on its position in a number."},
            {"term": "expanded notation", "definition": "A way to write numbers showing the value of each digit as a sum."},
            {"term": "power of ten", "definition": "A number written with a base of 10 and an integer exponent, like 10²."}
        ],
        "common_mistakes": [
            "Using incorrect exponents, like writing 100 as 10¹ instead of 10².",
            "Multiplying the digit by the exponent instead of the place value (e.g. writing 3 × 2 instead of 3 × 10²).",
            "Forgetting to use brackets around each multiplication term."
        ],
        "real_world_connections": [
            "Our metric system of measurements (metres, kilometres, millimetres) is completely based on powers of ten.",
            "Scientific notation uses powers of ten to write very large distances in space, like the distance from Earth to the Sun."
        ],
        "additional_worked_examples": [
            {
                "question": "Write the number 720 in expanded notation using powers of 10.",
                "answer": "(7 × 10²) + (2 × 10¹) + (0 × 10⁰)",
                "steps": [
                    {"step": 1, "instruction": "Identify the place value of each digit: 7 is hundreds, 2 is tens, 0 is ones.", "result": "700 + 20 + 0"},
                    {"step": 2, "instruction": "Convert place values to powers of 10: hundreds is 10², tens is 10¹, ones is 10⁰.", "result": "7 × 10², 2 × 10¹, 0 × 10⁰"},
                    {"step": 3, "instruction": "Write as a sum of products using brackets.", "result": "(7 × 10²) + (2 × 10¹) + (0 × 10⁰)"}
                ]
            },
            {
                "question": "Write the number 5,613 in expanded notation using powers of 10.",
                "answer": "(5 × 10³) + (6 × 10²) + (1 × 10¹) + (3 × 10⁰)",
                "steps": [
                    {"step": 1, "instruction": "Identify the place value of each digit: 5 is thousands, 6 is hundreds, 1 is tens, 3 is ones.", "result": "5000 + 600 + 10 + 3"},
                    {"step": 2, "instruction": "Convert place values to powers of 10: thousands is 10³, hundreds is 10², tens is 10¹, ones is 10⁰.", "result": "5 × 10³, 6 × 10², 1 × 10¹, 3 × 10⁰"},
                    {"step": 3, "instruction": "Write as a sum of products.", "result": "(5 × 10³) + (6 × 10²) + (1 × 10¹) + (3 × 10⁰)"}
                ]
            }
        ],
        "external_resources": []
    },
    "AC9M7N01": {
        "prerequisite_topics": [],
        "learning_objectives": [
            "Calculate the square of a natural number.",
            "Find the square root of a perfect square number.",
            "Explain how squaring and finding square roots are inverse operations."
        ],
        "explanation_sections": [
            {
                "heading": "What is Squaring?",
                "body": "To square a number, we multiply it by itself. For example, 4 squared is written as 4² and means 4 × 4, which equals 16. The name comes from geometry: a square with a side length of 4 units has an area of 16 square units.",
                "type": "concept"
            },
            {
                "heading": "What is a Square Root?",
                "body": "Finding a square root is the exact opposite of squaring a number. The square root of a number is the value that, when multiplied by itself, gives the original number. The symbol for square root is √. So, √16 is 4, because 4 × 4 = 16.",
                "type": "concept"
            },
            {
                "heading": "Inverse Operations",
                "body": "Squaring and finding square roots are inverse operations. This means they undo each other, just like addition and subtraction do. If you square 5 to get 25, taking the square root of 25 brings you back to 5. We write this relationship as √x² = x.",
                "type": "method"
            },
            {
                "heading": "Worked Example: Squares and Roots",
                "body": "Let us check the square root of 49. We want to find a number that multiplies by itself to make 49. We know that 7 × 7 = 49. Therefore, 7 squared is 49 (7² = 49), and the square root of 49 is 7 (√49 = 7).",
                "type": "example"
            },
            {
                "heading": "Common Pitfall: Half vs Root",
                "body": "Do not confuse finding a square root with dividing by two. For example, the square root of 9 is 3, because 3 × 3 = 9. It is not 4.5. Always check your answer by multiplying it by itself to see if you get the original number.",
                "type": "warning"
            }
        ],
        "key_vocabulary": [
            {"term": "perfect square", "definition": "A number that can be written as the product of a whole number multiplied by itself, like 9 or 25."},
            {"term": "square root", "definition": "A number that, when multiplied by itself, equals a given number."},
            {"term": "inverse operation", "definition": "An operation that reverses or undoes the effect of another operation."}
        ],
        "common_mistakes": [
            "Dividing the number by 2 instead of finding the square root (e.g. writing √36 = 18 instead of 6).",
            "Multiplying a number by 2 when squaring it (e.g. writing 5² = 10 instead of 25)."
        ],
        "real_world_connections": [
            "Tilers use square roots to calculate how many tiles fit along the edge of a square room if they know the total area.",
            "The screen sizes of TVs and phones are calculated using square roots and diagonal lengths."
        ],
        "additional_worked_examples": [
            {
                "question": "Find the square of 12.",
                "answer": "144",
                "steps": [
                    {"step": 1, "instruction": "Write the squaring problem as a multiplication of the number by itself.", "result": "12² = 12 × 12"},
                    {"step": 2, "instruction": "Multiply the numbers to find the final result.", "result": "144"}
                ]
            },
            {
                "question": "Find the square root of 81.",
                "answer": "9",
                "steps": [
                    {"step": 1, "instruction": "Identify which whole number, when multiplied by itself, equals 81.", "result": "9 × 9 = 81"},
                    {"step": 2, "instruction": "Write down that number as the square root.", "result": "√81 = 9"}
                ]
            }
        ],
        "external_resources": []
    },
    "AC9M7N04": {
        "prerequisite_topics": ["AC9M7N02"],
        "learning_objectives": [
            "Convert between fractions, decimals, and percentages.",
            "Locate rational numbers accurately on a number line.",
            "Identify equivalent representations of the same rational value."
        ],
        "explanation_sections": [
            {
                "heading": "What are Rational Numbers?",
                "body": "A rational number is any number that can be written as a fraction. This means it can be written as one integer divided by another. Rational numbers can look like fractions, decimals, or percentages. They all represent parts of a whole value.",
                "type": "concept"
            },
            {
                "heading": "Converting Between Forms",
                "body": "To convert a fraction to a decimal, divide the numerator by the denominator. To convert a decimal to a percentage, multiply by 100. To convert a percentage back to a fraction, write the percentage over 100 and simplify.",
                "type": "method"
            },
            {
                "heading": "Mapping to a Number Line",
                "body": "A number line helps us compare rational numbers. To place a fraction, divide the space between whole numbers into equal parts matching the denominator. Then count the parts to find the spot. Decimals can be located by thinking of tenths.",
                "type": "method"
            },
            {
                "heading": "Worked Example: Converting 3/5",
                "body": "Let us convert 3/5 to a decimal and a percentage. First, divide 3 by 5, which gives 0.6. Next, multiply 0.6 by 100 to get 60%. So, 3/5, 0.6, and 60% are equivalent representations of the same value.",
                "type": "example"
            },
            {
                "heading": "Common Pitfall: Decimal Placement",
                "body": "Be careful when converting small decimals to percentages. For example, 0.05 is 5%, not 50%. Always multiply the decimal by 100 (move the decimal point two places to the right) to find the correct percentage.",
                "type": "warning"
            }
        ],
        "key_vocabulary": [
            {"term": "rational number", "definition": "A number that can be written as a fraction of two integers."},
            {"term": "equivalent", "definition": "Having the same value or representing the same amount."},
            {"term": "numerator", "definition": "The top number in a fraction, showing how many parts we have."},
            {"term": "denominator", "definition": "The bottom number in a fraction, showing how many equal parts the whole is divided into."}
        ],
        "common_mistakes": [
            "Confusing 0.1 with 1% instead of 10%.",
            "Dividing the denominator by the numerator when converting a fraction to a decimal.",
            "Forgetting to simplify fractions to their simplest form."
        ],
        "real_world_connections": [
            "We see rational numbers every day: 50% off sales at the shops, 0.25 litres of milk in a recipe, or sharing half a pizza.",
            "Sports statistics use equivalent forms, like a cricketer's batting strike rate or a basketballer's free throw percentage."
        ],
        "additional_worked_examples": [
            {
                "question": "Convert 7/20 to a decimal and a percentage.",
                "answer": "0.35 or 35%",
                "steps": [
                    {"step": 1, "instruction": "Divide the numerator 7 by the denominator 20.", "result": "7 ÷ 20 = 0.35"},
                    {"step": 2, "instruction": "Multiply the decimal 0.35 by 100 to convert to a percentage.", "result": "0.35 × 100 = 35%"}
                ]
            },
            {
                "question": "Place 4/5 on a number line between 0 and 1.",
                "answer": "At the 4th mark when dividing 0 to 1 into 5 equal intervals.",
                "steps": [
                    {"step": 1, "instruction": "Divide the interval between 0 and 1 into 5 equal parts.", "result": "Marks at 1/5, 2/5, 3/5, 4/5"},
                    {"step": 2, "instruction": "Count 4 intervals from 0 to locate the fraction.", "result": "Located at 4/5 (or 0.8)"}
                ]
            }
        ],
        "external_resources": []
    },
    "AC9M7N07": {
        "prerequisite_topics": [],
        "learning_objectives": [
            "Compare and order positive and negative integers on a number line.",
            "Add positive and negative integers using directed number rules.",
            "Subtract positive and negative integers by converting to addition."
        ],
        "explanation_sections": [
            {
                "heading": "What are Integers?",
                "body": "Integers are whole numbers that can be positive, negative, or zero. We write negative integers with a minus sign, like -3 or -10. Positive numbers are to the right of zero on a number line. Negative numbers are to the left of zero, getting smaller as you move left.",
                "type": "concept"
            },
            {
                "heading": "Adding Negative Integers",
                "body": "Adding a negative number means moving to the left on a number line. This is exactly the same as subtracting a positive number. For example, if you have $5 and add a debt of $3 (which is -3), you write 5 + (-3) = 5 - 3 = 2.",
                "type": "method"
            },
            {
                "heading": "Subtracting Negative Integers",
                "body": "Subtracting a negative number is like taking away a debt, which makes you richer! It is equivalent to adding a positive number. When you see two minus signs next to each other, they combine to make a plus. For example, 5 - (-3) becomes 5 + 3 = 8.",
                "type": "method"
            },
            {
                "heading": "Worked Example: Integer Calculation",
                "body": "Let us calculate -4 - (-6). First, look at the subtraction of the negative: -(-6) becomes +6. Now rewrite the expression: -4 + 6. Starting at -4 on the number line and moving 6 steps to the right brings us to 2. So, -4 - (-6) = 2.",
                "type": "example"
            },
            {
                "heading": "Common Pitfall: Signs next to each other",
                "body": "Always look at the sign rules when signs are side-by-side. Plus and minus make minus: +(-) = -. Minus and minus make plus: -(-) = +. Do not confuse this with the signs of the final answer when adding numbers.",
                "type": "warning"
            }
        ],
        "key_vocabulary": [
            {"term": "integer", "definition": "A positive or negative whole number, or zero."},
            {"term": "negative number", "definition": "A number that is less than zero."},
            {"term": "directed numbers", "definition": "Numbers that have both size and direction (positive or negative) relative to zero."}
        ],
        "common_mistakes": [
            "Thinking that a larger digit with a negative sign is larger than a smaller digit (e.g. thinking -10 is greater than -2).",
            "Applying multiplication sign rules to addition (e.g. writing -5 - 3 = +8 because 'two minuses make a plus')."
        ],
        "real_world_connections": [
            "We use integers to describe cold winter temperatures below zero degrees Celsius.",
            "Bank accounts use negative balances to show debt or overdrafts, and positive balances to show savings."
        ],
        "additional_worked_examples": [
            {
                "question": "Calculate -7 + 3.",
                "answer": "-4",
                "steps": [
                    {"step": 1, "instruction": "Start at -7 on the number line.", "result": "Position is -7"},
                    {"step": 2, "instruction": "Move 3 units to the right because you are adding positive 3.", "result": "-7 + 3 = -4"}
                ]
            },
            {
                "question": "Calculate -3 - (-8).",
                "answer": "5",
                "steps": [
                    {"step": 1, "instruction": "Rewrite the double negative sign -(-8) as addition +8.", "result": "-3 + 8"},
                    {"step": 2, "instruction": "Start at -3 on the number line and move 8 units to the right.", "result": "5"}
                ]
            }
        ],
        "external_resources": []
    },
    "AC9M7N06": {
        "prerequisite_topics": ["AC9M7N04"],
        "learning_objectives": [
            "Perform addition and subtraction of fractions and mixed numbers.",
            "Multiply and divide fractions and mixed numbers.",
            "Solve practical multi-step problems involving rational number operations."
        ],
        "explanation_sections": [
            {
                "heading": "Adding and Subtracting Fractions",
                "body": "To add or subtract fractions, they must have the same denominator (bottom number). Find the lowest common denominator, convert each fraction, then add or subtract the numerators while keeping the denominator the same. For example, 1/4 + 1/6 = 3/12 + 2/12 = 5/12.",
                "type": "method"
            },
            {
                "heading": "Multiplying Fractions",
                "body": "Multiplying fractions is straightforward: multiply the top numbers (numerators) together, and multiply the bottom numbers (denominators) together. Simplify the resulting fraction if possible. For example, 2/3 × 3/5 = 6/15, which simplifies to 2/5.",
                "type": "method"
            },
            {
                "heading": "Dividing Fractions",
                "body": "To divide by a fraction, multiply by its reciprocal. The reciprocal is found by turning the dividing fraction upside down (swapping numerator and denominator). For example, 3/5 ÷ 1/2 becomes 3/5 × 2/1 = 6/5.",
                "type": "method"
            },
            {
                "heading": "Worked Example: Operations with Mixed Numbers",
                "body": "Let us calculate 1 1/2 + 2/3. First, convert the mixed number 1 1/2 to the improper fraction 3/2. Find a common denominator for 2 and 3, which is 6. Convert the fractions: 3/2 = 9/6, and 2/3 = 4/6. Add the numerators: 9/6 + 4/6 = 13/6. Convert back to a mixed number: 2 1/6.",
                "type": "example"
            },
            {
                "heading": "Common Pitfall: Adding Denominators",
                "body": "Never add the denominators of fractions together. For example, 1/3 + 1/3 is 2/3, not 2/6. The denominator represents the size of the fractional parts, which does not change when they are added together.",
                "type": "warning"
            }
        ],
        "key_vocabulary": [
            {"term": "reciprocal", "definition": "The inverse of a fraction, found by swapping the numerator and denominator."},
            {"term": "common denominator", "definition": "A shared multiple of the denominators of two or more fractions."},
            {"term": "improper fraction", "definition": "A fraction where the numerator is greater than or equal to the denominator."}
        ],
        "common_mistakes": [
            "Adding the denominators directly (e.g. 1/2 + 1/3 = 2/5).",
            "Forgetting to convert mixed numbers to improper fractions before multiplying or dividing.",
            "Dividing by a fraction without flipping it to its reciprocal first."
        ],
        "real_world_connections": [
            "Bakers multiply fractions when scaling recipes up or down to make different batch sizes.",
            "Carpenters calculate lengths by adding fraction measurements of timber pieces."
        ],
        "additional_worked_examples": [
            {
                "question": "Calculate 3/4 - 1/3.",
                "answer": "5/12",
                "steps": [
                    {"step": 1, "instruction": "Find the lowest common denominator for 4 and 3.", "result": "The LCD is 12."},
                    {"step": 2, "instruction": "Convert both fractions to have denominator 12: 3/4 = 9/12, and 1/3 = 4/12.", "result": "9/12 and 4/12"},
                    {"step": 3, "instruction": "Subtract the numerators.", "result": "9/12 - 4/12 = 5/12"}
                ]
            },
            {
                "question": "Calculate 3/5 ÷ 1/2.",
                "answer": "1 1/5",
                "steps": [
                    {"step": 1, "instruction": "Change the division sign to multiplication and write the reciprocal of 1/2.", "result": "3/5 × 2/1"},
                    {"step": 2, "instruction": "Multiply the first fraction by this reciprocal: 3/5 × 2/1.", "result": "6/5"},
                    {"step": 3, "instruction": "Convert the improper fraction to a mixed number.", "result": "1 1/5"}
                ]
            }
        ],
        "external_resources": []
    },
    "AC9M7N08": {
        "prerequisite_topics": [],
        "learning_objectives": [
            "Write ratios to compare two or more quantities.",
            "Simplify ratios by dividing terms by their greatest common divisor.",
            "Solve division-into-ratio word problems."
        ],
        "explanation_sections": [
            {
                "heading": "What is a Ratio?",
                "body": "A ratio compares the sizes of two or more quantities of the same unit. We use a colon to separate the parts, like 2:3, which is read as 'two to three'. Ratios do not show actual amounts, but rather the relative balance between them.",
                "type": "concept"
            },
            {
                "heading": "Simplifying Ratios",
                "body": "Just like fractions, ratios can be simplified to make them easier to understand. To simplify a ratio, find the greatest common divisor (GCD) of all the terms. Then divide every term by that number. For example, 10:15 simplifies to 2:3 after dividing by 5.",
                "type": "method"
            },
            {
                "heading": "Dividing Quantities in a Given Ratio",
                "body": "To share an amount into a given ratio: first, add the parts of the ratio to find the total number of parts. Next, divide the total amount by this sum to find the value of one part. Finally, multiply each part of the ratio by the value of one part.",
                "type": "method"
            },
            {
                "heading": "Worked Example: Sharing $50 in 2:3",
                "body": "Let us share $50 between two people in the ratio 2:3. First, add the parts: 2 + 3 = 5 total parts. Next, divide $50 by 5: $50 ÷ 5 = $10 per part. Finally, multiply each share: the first gets 2 × $10 = $20, and the second gets 3 × $10 = $30.",
                "type": "example"
            },
            {
                "heading": "Common Pitfall: Different Units",
                "body": "Never write a ratio using different units. For example, to compare 50 cents to $2, you must convert them to the same unit first. Convert $2 to 200 cents, so the ratio is 50:200, which simplifies to 1:4. Writing 50:2 is incorrect.",
                "type": "warning"
            }
        ],
        "key_vocabulary": [
            {"term": "ratio", "definition": "A comparison of two or more numbers showing their relative sizes."},
            {"term": "greatest common divisor", "definition": "The largest whole number that divides evenly into two or more numbers."},
            {"term": "simplify", "definition": "To write a ratio in its lowest terms with no common factors left between the parts."}
        ],
        "common_mistakes": [
            "Writing ratios using different units without converting them first (e.g. 10mm to 5cm written as 10:5 instead of 10:50).",
            "Dividing by the wrong total parts when sharing an amount (e.g. dividing by the individual parts instead of their sum)."
        ],
        "real_world_connections": [
            "Vitamins, paint mixtures, concrete, and cordial drinks are all made by mixing ingredients in specific ratios.",
            "Scale models and maps use ratios (like 1:100) to represent real-life objects in a smaller size."
        ],
        "additional_worked_examples": [
            {
                "question": "Simplify the ratio 18:24 to its simplest form.",
                "answer": "3:4",
                "steps": [
                    {"step": 1, "instruction": "Find the greatest common divisor of 18 and 24.", "result": "The GCD is 6."},
                    {"step": 2, "instruction": "Divide both terms by 6.", "result": "18 ÷ 6 : 24 ÷ 6 = 3:4"}
                ]
            },
            {
                "question": "Share 30 lollies in the ratio 1:2:3.",
                "answer": "5, 10, and 15 lollies",
                "steps": [
                    {"step": 1, "instruction": "Add the parts of the ratio together to find total parts.", "result": "1 + 2 + 3 = 6 parts"},
                    {"step": 2, "instruction": "Divide the total lollies by the total parts.", "result": "30 ÷ 6 = 5 lollies per part"},
                    {"step": 3, "instruction": "Multiply each ratio share by 5.", "result": "1×5 = 5, 2×5 = 10, 3×5 = 15"}
                ]
            }
        ],
        "external_resources": []
    },
    "AC9M7N09": {
        "prerequisite_topics": ["AC9M7N04"],
        "learning_objectives": [
            "Calculate the percentage of a given amount.",
            "Increase or decrease a quantity by a given percentage.",
            "Solve financial problems involving discounts, markups, and simple interest."
        ],
        "explanation_sections": [
            {
                "heading": "Calculating a Percentage of an Amount",
                "body": "Percentage means 'out of 100'. To find a percentage of any number, write the percentage as a fraction out of 100 (or as a decimal) and multiply it by that number. For example, 20% of $80 is 20/100 × 80, which is 0.2 × 80 = $16.",
                "type": "concept"
            },
            {
                "heading": "Percentage Increase and Decrease",
                "body": "To increase an amount by a percentage, find the percentage value first, then add it to the original amount. Alternatively, multiply by (100% + increase%). To decrease, subtract the percentage value, or multiply by (100% - decrease%).",
                "type": "method"
            },
            {
                "heading": "Discounts and Markups",
                "body": "Discounts make items cheaper, while markups make them more expensive. If an item has a 10% discount, the new price is 90% of the original. If a shop adds a 25% markup to wholesale costs, the retail price is 125% of the wholesale cost.",
                "type": "method"
            },
            {
                "heading": "Worked Example: Calculating simple discount",
                "body": "Let us find the sale price of a $120 jacket discounted by 15%. First, find 15% of $120: 0.15 × $120 = $18. Next, subtract the discount from the original price: $120 - $18 = $102. The sale price is $102.",
                "type": "example"
            },
            {
                "heading": "Common Pitfall: Percentage Points Addition",
                "body": "Never add percentages directly when applying consecutive changes. For example, a 10% discount followed by another 10% discount is not a 20% discount. The second discount is calculated on the already-reduced price, not the original price.",
                "type": "warning"
            }
        ],
        "key_vocabulary": [
            {"term": "percentage", "definition": "A fraction out of 100, represented by the symbol %."},
            {"term": "discount", "definition": "An amount subtracted from the normal price of an item."},
            {"term": "markup", "definition": "An amount added to the cost price of goods to cover overheads and profit."}
        ],
        "common_mistakes": [
            "Dividing by the percentage value instead of multiplying (e.g. dividing by 0.10 to find 10%).",
            "Applying percentage changes consecutively by adding percentages (e.g. 10% tax + 10% discount = 0% change)."
        ],
        "real_world_connections": [
            "Finding sale prices during holiday shopping seasons is a direct application of percentage decrease.",
            "Understanding payslip tax rates and calculating bank interest on savings accounts use percentage calculations."
        ],
        "additional_worked_examples": [
            {
                "question": "Increase $80 by 15%.",
                "answer": "$92",
                "steps": [
                    {"step": 1, "instruction": "Find 15% of $80.", "result": "0.15 × 80 = $12"},
                    {"step": 2, "instruction": "Add the increase to the original amount.", "result": "$80 + $12 = $92"}
                ]
            },
            {
                "question": "A shop buys a book for $20 and adds a 30% markup. Find the selling price.",
                "answer": "$26",
                "steps": [
                    {"step": 1, "instruction": "Calculate the markup amount: 30% of $20.", "result": "0.30 × 20 = $6"},
                    {"step": 2, "instruction": "Add the markup to the cost price.", "result": "$20 + $6 = $26"}
                ]
            }
        ],
        "external_resources": []
    }
}

# Define Year 7 ATAR pathways according to schema (target_senior_subjects, importance_level, connection_description)
ATAR_PATHWAYS = {
    "AC9M7N02": {
        "target_senior_subjects": ["Mathematical Methods", "Specialist Mathematics"],
        "importance_level": "Essential Foundation",
        "connection_description": "Prime factorisation and index laws form the mathematical bedrock for Senior Methods Unit 1 (Exponential Functions) and Specialist Unit 1 (Number Theory and Proofs)."
    },
    "AC9M7N03": {
        "target_senior_subjects": ["Mathematical Methods"],
        "importance_level": "Medium",
        "connection_description": "Expanded notation with powers of 10 forms the base for understanding exponential functions and scientific notation in Senior Methods."
    },
    "AC9M7N01": {
        "target_senior_subjects": ["Mathematical Methods", "Specialist Mathematics"],
        "importance_level": "Essential Foundation",
        "connection_description": "Square roots are the basis of quadratic functions in Methods Unit 1 and complex numbers in Specialist Unit 2."
    },
    "AC9M7N07": {
        "target_senior_subjects": ["Mathematical Methods", "Specialist Mathematics"],
        "importance_level": "Essential Foundation",
        "connection_description": "Signed number arithmetic is vital for algebraic manipulation and function transformations in all senior mathematics."
    },
    "AC9M7N06": {
        "target_senior_subjects": ["Mathematical Methods", "Specialist Mathematics"],
        "importance_level": "Essential Foundation",
        "connection_description": "Fraction arithmetic and decimal conversions are used extensively in probability, calculus, and algebra across all senior syllabuses."
    },
    "AC9M7N04": {
        "target_senior_subjects": ["Mathematical Methods", "Specialist Mathematics"],
        "importance_level": "Essential Foundation",
        "connection_description": "Equivalent representations of rational numbers form a key baseline for algebraic scaling and graphing functions."
    },
    "AC9M7N08": {
        "target_senior_subjects": ["Mathematical Methods", "General Mathematics"],
        "importance_level": "Medium",
        "connection_description": "Ratios are fundamental for rate calculations, scale drawings, and similarity in Senior General Mathematics and Methods."
    },
    "AC9M7N09": {
        "target_senior_subjects": ["General Mathematics", "Mathematical Methods"],
        "importance_level": "High",
        "connection_description": "Percentage increases/decreases form the basis of simple and compound interest calculations in General Mathematics Unit 1."
    }
}

# Define Year 7 habit challenges according to schema (challenge_id, description, habit_focus)
HABIT_CHALLENGES = {
    "AC9M7N02": [
        {
            "challenge_id": "factor_tree_neatness",
            "description": "Draw factor trees level by level clearly on scratch paper to avoid arithmetic errors.",
            "habit_focus": "Orderly calculation steps to avoid transcription errors"
        }
    ],
    "AC9M7N03": [
        {
            "challenge_id": "zero_place_value_check",
            "description": "Explicitly write 0 × 10^k for missing columns in expanded notation to reinforce place value.",
            "habit_focus": "Attention to detail and place value structure"
        }
    ],
    "AC9M7N01": [
        {
            "challenge_id": "perfect_squares_recitation",
            "description": "Write down perfect squares from 1² to 15² from memory before starting exercise sets.",
            "habit_focus": "Fluency in numerical recall"
        }
    ],
    "AC9M7N07": [
        {
            "challenge_id": "sign_rule_sanity_check",
            "description": "Circle double signs (like -(-x)) and rewrite them as a single sign before performing calculations.",
            "habit_focus": "Minimising sign errors under exam conditions"
        }
    ],
    "AC9M7N06": [
        {
            "challenge_id": "common_denominator_neatness",
            "description": "Write equivalent fractions side-by-side with clear denominator headings on scratch paper.",
            "habit_focus": "Structured fraction layout to prevent arithmetic slip-ups"
        }
    ],
    "AC9M7N04": [
        {
            "challenge_id": "simplify_fractions_neatness",
            "description": "Cross out and write simplified fractions clearly on scratch paper to avoid visual clutter.",
            "habit_focus": "Orderly calculation steps to avoid transcription errors"
        }
    ],
    "AC9M7N08": [
        {
            "challenge_id": "unit_alignment_check",
            "description": "Always underline and check the units of both quantities before writing a ratio comparison.",
            "habit_focus": "Dimensional awareness and unit checking"
        }
    ],
    "AC9M7N09": [
        {
            "challenge_id": "decimal_multiplier_method",
            "description": "Solve discount/markup problems by converting percentages to decimal multipliers (e.g. 15% discount -> multiply by 0.85).",
            "habit_focus": "Calculation efficiency and speed"
        }
    ]
}

def main():
    json_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "curriculum", "ac9_maths", "year7.json")
    print(f"Loading {json_path}...")
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # 1. Update fields
    updated_count = 0
    for topic in data.get("topics", []):
        topic_id = topic.get("topic_id")
        if topic_id in LESSON_CONTENTS:
            # Set concept_card.lesson_content
            if "concept_card" not in topic:
                topic["concept_card"] = {}
            topic["concept_card"]["lesson_content"] = LESSON_CONTENTS[topic_id]
            
            # Sibling fields: atar_pathway and habit_challenges
            if topic_id in ATAR_PATHWAYS:
                topic["atar_pathway"] = ATAR_PATHWAYS[topic_id]
            else:
                topic["atar_pathway"] = None
                
            if topic_id in HABIT_CHALLENGES:
                topic["habit_challenges"] = HABIT_CHALLENGES[topic_id]
            else:
                topic["habit_challenges"] = []
                
            updated_count += 1
            print(f"Injected lesson_content, atar_pathway, and habit_challenges for {topic_id}")

    if updated_count == 0:
        print("Error: No matching topics found to update!")
        sys.exit(1)

    # 2. Validate using Pydantic FrameworkSliceFile schema
    print("Validating updated JSON structure against Pydantic schema...")
    try:
        FrameworkSliceFile(**data)
        print("Pydantic validation passed successfully!")
    except Exception as e:
        print(f"Pydantic validation failed: {e}", file=sys.stderr)
        sys.exit(1)

    # 3. Write back to file
    print(f"Saving changes to {json_path}...")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    print("Done! Lesson content, ATAR pathway, and habit challenges successfully generated, saved, and validated.")

if __name__ == "__main__":
    main()
