/**
 * QCAA ISMG PSMT criteria — shared between frontend PSMT page and backend PSMT evaluator.
 * Matches the QCAA IA1 syllabus: Formulate, Solve, Evaluate and verify, Communicate.
 */

export interface PsmtCriterion {
  text: string;
  explanation: string;
  example: string;
  mistake: string;
}

export interface PsmtSection {
  title: string;
  description: string;
  criteria: PsmtCriterion[];
}

export const PSMT_GUIDELINES: Record<string, PsmtSection> = {
  Formulate: {
    title: "Formulate",
    description: "Translate the real-world problem into a mathematical model. You need to establish assumptions, define variables, and choose appropriate mathematical paths.",
    criteria: [
      {
        text: "Define all variables and constants with appropriate units.",
        explanation: "List every mathematical symbol (e.g., d, t, v, g) used in your report and state what real-world quantity it represents, along with its standard units.",
        example: "Let 'd' represent the horizontal displacement of the projectile in meters (m), 't' represent the time of flight in seconds (s), and 'g' represent the acceleration due to gravity, assumed constant at 9.8 m/s².",
        mistake: "Using symbols in equations without defining them first, or writing definitions without specifying units (e.g., defining 't' as 'time' instead of 'time in seconds (s)')."
      },
      {
        text: "List assumptions and provide logical justifications for why they are reasonable.",
        explanation: "State the simplifications you make to the real world to make the math solvable, and justify why each assumption is valid for your specific scenario.",
        example: "Assumption: The flight occurs in a windless environment (no air resistance). Justification: The projectile is small and dense (a metal ball-bearing) and the drop height is low (under 2 meters), meaning drag forces will have a negligible effect (<1%) on the trajectory.",
        mistake: "Listing assumptions as a bulleted list without any explanation/justification of why they are acceptable to make."
      },
      {
        text: "Identify constraints and boundary conditions of the real-world situation.",
        explanation: "Define the physical limits and domain/range restrictions that govern your scenario based on real-world constraints.",
        example: "Boundary condition: At t = 0, initial height h(0) = 1.5 m. Physical constraint: Time t >= 0 and height h(t) >= 0, as the motion ceases once the projectile impacts the ground.",
        mistake: "Letting the mathematical model yield impossible values (e.g., negative time or negative height) without specifying constraints where the model stops."
      },
      {
        text: "Select and justify the mathematical pathways/models you will use.",
        explanation: "Explain why you selected a specific mathematical model (e.g., quadratic, exponential, linear) and how it fits the nature of the physical problem.",
        example: "A quadratic model of the form y = ax² + bx + c was chosen because gravity acts as a constant downward acceleration, meaning vertical displacement is mathematically proportional to the square of elapsed time.",
        mistake: "Jumping directly into calculations without any explanation of why you selected those specific formulas or mathematical methods."
      }
    ]
  },
  Solve: {
    title: "Solve",
    description: "Execute mathematical procedures to solve the model. Present your calculations, code, or spreadsheet formulas clearly and systematically.",
    criteria: [
      {
        text: "Show step-by-step mathematical procedures and calculations.",
        explanation: "Provide clear, logical, and consecutive steps for all calculations. Do not omit intermediate steps or present answers out of nowhere.",
        example: "h(t) = -4.9t² + 12t + 1.5\nSetting h(t) = 0:\n-4.9t² + 12t + 1.5 = 0\nUsing the quadratic formula:\nt = (-12 ± √(12² - 4(-4.9)(1.5))) / (2(-4.9))\nt = (-12 ± √(144 + 29.4)) / -9.8\nt ≈ -0.12 s or t ≈ 2.57 s. Since t >= 0, flight time is 2.57 s.",
        mistake: "Skipping intermediate algebraic steps, or presenting only the final numerical solution without the working out."
      },
      {
        text: "Format graphs, tables, and diagrams with proper titles, axis labels, and scales.",
        explanation: "Every visual representation must be fully labeled, numbered, self-contained, and clear, with appropriate titles, gridlines, and units on axes.",
        example: "Figure 1: Projectile Trajectory (Height y in meters vs. Horizontal Distance x in meters) with a trendline equation y = -0.1x² + 0.8x + 1.5 and R² = 0.998.",
        mistake: "Pasting screenshots directly from Excel or Desmos without axes labels, units, figure numbers, or descriptive captions."
      },
      {
        text: "Ensure accuracy of mathematical solutions, parameters, and coefficients.",
        explanation: "Double-check your calculations, state coefficients with appropriate significant figures/decimal places, and explain regression metrics (like R²).",
        example: "The quadratic regression model yielded coefficients of a = -4.896 (3 d.p.) and b = 12.012 (3 d.p.). The R² value of 0.9987 indicates that 99.87% of the vertical variance is explained by time.",
        mistake: "Rounding numbers prematurely during intermediate steps, which leads to cumulative rounding errors in the final result."
      },
      {
        text: "Document the use of technology (e.g., TI-84 calculator keys, Excel formulas).",
        explanation: "State the software, calculator model, and exact functions or formulas used to complete the calculations.",
        example: "Excel regression tools were utilized to determine the trendline equation. Calculator steps: On a TI-84 Plus, the 'QuadReg' function in the STAT -> CALC menu was executed with lists L1 and L2.",
        mistake: "Stating 'I used Excel to find the equation' without documenting the specific formulas, functions, or inputs used."
      }
    ]
  },
  Evaluate: {
    title: "Evaluate and verify",
    description: "Evaluate and verify the mathematical solution in the context of the real-world scenario. Check if it makes sense, identify limitations, validate results, and analyze sensitivity.",
    criteria: [
      {
        text: "Critically evaluate the reasonableness of the mathematical results in the real world.",
        explanation: "Assess whether your mathematical results make physical sense in context (e.g., comparing predicted speeds or heights to realistic physical parameters).",
        example: "The calculated flight time of 2.57 seconds is highly reasonable, as gravity is the primary force, and similar real-world throws of a shotput yield flight times of 2 to 3 seconds.",
        mistake: "Simply stating 'the results are reasonable' without providing any comparison, data, or physical arguments to back it up."
      },
      {
        text: "Discuss the limitations of your model (e.g., where it fails or becomes inaccurate).",
        explanation: "Identify the boundaries of your model. Where does the mathematical simplification fail to capture the complexity of the real world?",
        example: "Limitation: The quadratic model assumes air resistance is zero. Over longer horizontal distances (e.g., >50 meters), air resistance would slow the horizontal velocity, causing the real trajectory to fall short of the model's parabolic prediction.",
        mistake: "Claiming the model has no limitations, or identifying vague, unhelpful limitations like 'human error' or 'calculator rounding'."
      },
      {
        text: "Perform sensitivity analysis (e.g., how changing a parameter affects the outcome).",
        explanation: "Quantify how a small change in one of your inputs or assumptions (e.g., a 10% change in angle) affects the model's output.",
        example: "Sensitivity Analysis: Increasing the launch velocity parameter by 10% (from 12.0 m/s to 13.2 m/s) results in the predicted range increasing by 21% (from 15.1 m to 18.3 m), showing that the model is highly sensitive to initial speed.",
        mistake: "Discussing sensitivity in a purely qualitative way ('if velocity increases, distance increases') without computing any numerical changes."
      },
      {
        text: "Suggest logical improvements or refinements to your model.",
        explanation: "Propose concrete, mathematical ways to refine the model to address the limitations you identified.",
        example: "To improve accuracy for high-speed scenarios, the model could be refined by introducing a velocity-dependent drag term -kv, changing the vertical acceleration equation to a_y = -g - (k/m)v_y.",
        mistake: "Proposing generic non-mathematical improvements, such as 'using a better ruler' or 'calculating more carefully next time'."
      }
    ]
  },
  Communicate: {
    title: "Communicate",
    description: "Present your findings as a coherent, structured mathematical report. Use appropriate terminology, notation, and formatting.",
    criteria: [
      {
        text: "Structure the report logically (e.g., Introduction, Formulate, Solve, Evaluate, Conclusion).",
        explanation: "Ensure your report is organized under clear, sequential sections matching standard QCAA mathematical reporting conventions.",
        example: "The report is structured into distinct chapters: 1. Introduction, 2. Formulation of Model, 3. Solving and Results, 4. Evaluation and Refinement, and 5. Conclusion & Appendix.",
        mistake: "Presenting a chaotic narrative that jumps back and forth between calculations and assumptions without clear headings."
      },
      {
        text: "Use formal, objective language and correct mathematical notation.",
        explanation: "Write in the formal, third-person objective voice. Use standard mathematical typesetting for symbols and equations rather than plain text representations.",
        example: "Write 'The quadratic regression model y = -4.9t² + 12t + 1.5 was established...' instead of 'We did a regression in Excel and got y = -4.9x^2 + 12x + 1.5.'",
        mistake: "Using informal pronouns ('I', 'we', 'my group') or computer notation (like using '*', '/', or '^' instead of mathematical symbols)."
      },
      {
        text: "Ensure all graphs and tables are referenced and integrated into the text.",
        explanation: "Every visual aid must be directly discussed, interpreted, and referenced by its figure/table number in the surrounding paragraphs.",
        example: "As illustrated by the data in Table 2, the vertical velocity decreases at a constant rate. This trend is visually depicted in Figure 3, where...",
        mistake: "Leaving graphs or tables 'floating' in the report without any text explaining what they represent or how they support the argument."
      },
      {
        text: "Adhere strictly to formatting guidelines and word counts (~2000 words max).",
        explanation: "Ensure the main body is concise and focused, keeping mathematical derivations and raw data formatted in the appendix if necessary to meet limits.",
        example: "The main body of the report contains exactly 1,850 words. Detailed raw measurement tables are placed in Appendix A, ensuring readability is maintained.",
        mistake: "Submitting a massive report (e.g., 3,500 words) or stuffing essential analysis into the appendix simply to bypass the word limit."
      }
    ]
  }
};
