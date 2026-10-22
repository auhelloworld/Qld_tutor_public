export interface WritingGuideline {
  text: string;
  explanation: string;
  example: string;
  mistake: string;
}

export interface WritingSection {
  title: string;
  description: string;
  criteria: WritingGuideline[];
}

export const WRITING_GUIDELINES: Record<string, WritingSection> = {
  persuasive: {
    title: "Persuasive Writing Guide",
    description: "Argue a clear position on a topic using reasoned arguments, persuasive devices, cohesive paragraphs, and a clear introduction and conclusion.",
    criteria: [
      {
        text: "Structure with an introduction, body, and conclusion.",
        explanation: "Orient the reader with a catchy opening (hook), state your thesis (clear opinion), outline 3 main arguments, and conclude by reinforcing your position.",
        example: "Introduction: 'School uniforms should be abolished. They restrict self-expression, cause financial strain, and do not improve performance.'",
        mistake: "Jumping directly into arguments without a clear introduction, or failing to summarize in the conclusion."
      },
      {
        text: "Apply persuasive and rhetorical devices.",
        explanation: "Use emotive language, rhetorical questions, statistics, expert quotes, and appeals to logic (logos) or emotion (pathos) to sway the reader.",
        example: "Rhetorical question: 'Can we truly justify silencing our students' individuality for the sake of conformity?'",
        mistake: "Making dry assertions without any persuasive techniques or emotional appeals to engage the reader."
      },
      {
        text: "Use transitional devices for strong cohesion.",
        explanation: "Link paragraphs and ideas smoothly using transition words (e.g., 'consequently', 'furthermore', 'on the other hand', 'nevertheless').",
        example: "Transition: 'Furthermore, school uniforms place an unnecessary financial burden on families who must purchase specialized gear...'",
        mistake: "Paragraphs that feel disconnected and jump from one point to another without logical linking words."
      },
      {
        text: "Keep the reader in mind.",
        explanation: "Make your position easy to follow, choose examples your audience will understand, and build toward a conclusion that reinforces your strongest reason.",
        example: "Audience move: 'For students who already feel pressure at school, a later start time could make learning healthier and more focused.'",
        mistake: "Writing a list of opinions without explaining why those reasons should matter to the reader."
      }
    ]
  },
  narrative: {
    title: "Narrative Writing Guide",
    description: "Craft an engaging story with developed characters, a vivid setting, a clear complication, and descriptive language that shapes the reader's response.",
    criteria: [
      {
        text: "Show, don't tell.",
        explanation: "Avoid simply stating emotions or actions. Use sensory details (sight, sound, smell) and character actions to make the scene alive.",
        example: "Show: 'Sarah's hands trembled as she pulled the crumpled paper from the envelope.' (Tell: 'Sarah was nervous to read the letter.')",
        mistake: "Writing dry summaries of events (e.g. 'He was angry and went home') instead of describing the character's reaction."
      },
      {
        text: "Structure around a clear narrative arc.",
        explanation: "Provide a hook orientation (setting/characters), introduce a complication (conflict/rising action), build to a climax, and resolve it.",
        example: "Conflict: The character receives a letter containing a secret message that contradicts everything they believed about their family.",
        mistake: "Stories that lack a central conflict or end abruptly without a satisfying resolution."
      },
      {
        text: "Develop characters and settings.",
        explanation: "Give your characters distinct voices and motives. Establish settings that create a strong mood or atmosphere (using pathetic fallacy).",
        example: "Setting: 'The rain lashed against the cracked window, mirroring the cold dread pooling in her stomach.'",
        mistake: "Characters who act without motivation, or settings that feel like flat, anonymous backdrops."
      },
      {
        text: "Shape the ending deliberately.",
        explanation: "Resolve the main complication or leave a purposeful question. The ending should feel connected to the character's choices and the story's mood.",
        example: "Ending move: the character keeps the letter, showing they are ready to face the truth later.",
        mistake: "Ending with 'then I woke up' or stopping suddenly without resolving or deepening the central problem."
      }
    ]
  },
  analytical: {
    title: "Analytical Paragraph Guide",
    description: "Analyse how authors use language, structure, and ideas to shape meaning. Junior responses often focus on one clear TEEL/PEEL paragraph.",
    criteria: [
      {
        text: "Start with a clear topic sentence.",
        explanation: "Answer the question directly and name the idea, character, theme, or technique you will analyse.",
        example: "Topic sentence: 'The storm imagery creates tension by making the setting feel dangerous and unpredictable.'",
        mistake: "Starting with plot summary before making a clear analytical point."
      },
      {
        text: "Use TEEL paragraphing structure.",
        explanation: "Organise body paragraphs systematically: Topic sentence, Evidence, Explanation/analysis, Link back to the thesis or prompt.",
        example: "TEEL Sentence: 'Fitzgerald's metaphor of the 'fresh, green breast of the new world' reinforces the thematic link between Daisy and America itself...'",
        mistake: "Writing paragraph blocks that have no clear topic sentences or lack textual evidence (quotes) to support claims."
      },
      {
        text: "Analyse language features, don't summarise the plot.",
        explanation: "Focus on how the author writes (motifs, imagery, metaphors, syntax) and the effects these choices have on positioning the reader.",
        example: "Analysis: 'The use of auditory imagery in the description of Daisy's 'voice full of money' highlights the superficial charm that masks her corruption.'",
        mistake: "Retelling the story (e.g. 'First Gatsby meets Daisy, then he hosts parties, then...') instead of explaining the author's stylistic techniques."
      },
      {
        text: "Link back to the question.",
        explanation: "End the paragraph by explaining how your evidence proves your point and answers the prompt.",
        example: "Link: 'This positions the reader to see the character's fear as reasonable rather than exaggerated.'",
        mistake: "Dropping in a quote and moving on without explaining its effect."
      }
    ]
  },
  expository: {
    title: "Informative / Expository Writing Guide",
    description: "Explain a topic clearly and accurately using a logical structure, relevant facts, examples, and precise language.",
    criteria: [
      {
        text: "Make the purpose and audience clear.",
        explanation: "Show what the reader will learn and keep the tone informative rather than argumentative or exaggerated.",
        example: "Opening: 'A technology-free day can help students understand both the benefits and challenges of relying less on devices.'",
        mistake: "Starting with a strong opinion such as 'Phones are terrible and must be banned' when the task asks you to explain."
      },
      {
        text: "Organise ideas in a logical sequence.",
        explanation: "Use an introduction, grouped body sections, and a conclusion or synthesis. Headings can help if the task allows them.",
        example: "Structure: introduction, benefit for focus, challenge for communication, practical solution, conclusion.",
        mistake: "Listing unrelated facts without grouping them into clear sections."
      },
      {
        text: "Develop explanations with facts and examples.",
        explanation: "Define key terms, explain causes and effects, and use concrete examples so the reader understands how and why something happens.",
        example: "Example: 'Without laptops, students may practise handwriting and discussion skills, but teachers would need printed resources ready.'",
        mistake: "Making broad claims such as 'it helps everyone' without explaining the reason or giving an example."
      },
      {
        text: "Use precise vocabulary and cohesive links.",
        explanation: "Choose topic-specific words and connect ideas with phrases such as 'for example', 'as a result', 'however', and 'in contrast'.",
        example: "Cohesion: 'However, a technology-free day could disadvantage students who use devices for accessibility support.'",
        mistake: "Repeating simple words or jumping between benefits and drawbacks without transitions."
      }
    ]
  }
};

const SENIOR_WRITING_GUIDELINES: Partial<Record<string, WritingSection>> = {
  persuasive: {
    title: "Public Audience Written Response Guide",
    description: "Analyse representations in text/s while shaping a written response for a public audience. The form may be an article, blog, essay, or column, depending on the task sheet.",
    criteria: [
      {
        text: "Analyse representations and perspectives in text/s.",
        explanation: "Keep textual analysis central: explain how concepts, identities, times, places, values, or beliefs are represented and positioned.",
        example: "Analysis move: 'The repeated contrast between private grief and public performance represents identity as something shaped by social expectation.'",
        mistake: "Only arguing a personal opinion without analysing how the text/s construct representations."
      },
      {
        text: "Use public-audience genre conventions deliberately.",
        explanation: "Shape the role of the writer and the form required by the task, such as article, blog, essay, or column. Use headings, leads, or direct address only when they suit the form.",
        example: "Column move: open with a current public concern, then connect it to the representation in the studied text/s.",
        mistake: "Assuming every public-audience response must be a feature article with a headline and subheadings."
      },
      {
        text: "Select, synthesise, and sequence subject matter.",
        explanation: "Choose the most relevant evidence, connect ideas across text/s, and use cohesive devices to emphasise relationships between ideas.",
        example: "Synthesis: 'Both texts frame belonging as conditional, but one critiques family loyalty while the other critiques public reputation.'",
        mistake: "Writing one disconnected paragraph per text without explaining the relationship between them."
      },
      {
        text: "Control language for audience and purpose.",
        explanation: "Use precise vocabulary, controlled sentence patterns, and written features that suit the public context while maintaining analytical depth.",
        example: "Public analytical voice: 'This representation matters because it asks contemporary readers to question who is allowed to belong.'",
        mistake: "Sounding either too casual for analysis or too essay-like for the nominated public audience."
      }
    ]
  },
  narrative: {
    title: "Imaginative Response Guide",
    description: "Create an imaginative response that uses a literary text as a springboard while developing your own perspective, representation, aesthetic choices, and purposeful structure.",
    criteria: [
      {
        text: "Use the studied text as a springboard.",
        explanation: "Draw on a perspective, concept, identity, setting, voice, motif, or conflict from the source text without simply retelling it.",
        example: "Springboard move: transform a minor symbol from the poem into the central object of a new short story.",
        mistake: "Copying the original plot or analysing the source text instead of creating an imaginative response."
      },
      {
        text: "Create perspectives and representations.",
        explanation: "Make deliberate choices about whose view is centred, what values are represented, and how the reader is invited to respond emotionally or critically.",
        example: "Perspective: first-person narration can reveal uncertainty while limiting what the reader knows.",
        mistake: "Writing events that happen to a character without shaping a clear viewpoint or representation."
      },
      {
        text: "Control structure and aesthetic features.",
        explanation: "Use sequencing, imagery, motif, symbolism, syntax, dialogue, or shifts in pace to create a deliberate effect.",
        example: "A recurring sound image can build unease before the final discovery.",
        mistake: "Adding decorative description that does not contribute to mood, character, or meaning."
      },
      {
        text: "Justify choices in the writer's statement.",
        explanation: "Explain audience, purpose, source-text connection, and specific craft choices. Keep it reflective rather than a plot summary.",
        example: "Writer's statement: 'I used second person to make readers complicit in the character's silence.'",
        mistake: "Only describing what happens in the story instead of justifying why the choices were made."
      }
    ]
  },
  analytical: {
    title: "Senior Analytical Essay Guide",
    description: "Develop a sustained analysis of how texts construct perspectives, representations, and meanings through aesthetic or stylistic choices. Use evidence and a formal academic register.",
    criteria: [
      {
        text: "Develop a defensible thesis.",
        explanation: "Give a clear argument that answers the prompt and can be sustained across the essay, rather than a broad topic statement.",
        example: "Thesis: 'The text represents ambition as both socially rewarded and morally corrosive through recurring images of performance.'",
        mistake: "Writing an introduction that lists themes but does not establish an argument."
      },
      {
        text: "Integrate textual evidence.",
        explanation: "Select precise evidence and embed it smoothly into sentences before analysing its effect.",
        example: "Evidence move: 'The image of a locked room positions memory as something both protected and imprisoning.'",
        mistake: "Dropping long quotes into the paragraph without explaining how the language works."
      },
      {
        text: "Analyse aesthetic and stylistic choices.",
        explanation: "Explain how language, structure, genre, narrative voice, imagery, or symbolism shapes meanings and positions readers.",
        example: "Analysis: fragmented syntax can mirror a character's unstable memory and position readers inside that uncertainty.",
        mistake: "Retelling the text or naming techniques without explaining their effect."
      },
      {
        text: "Sustain formal organisation and register.",
        explanation: "Sequence ideas logically, use cohesive links, and maintain a controlled academic voice appropriate for senior analytical writing.",
        example: "Cohesion: 'While the opening frames power as desirable, the final scene reframes it as isolating.'",
        mistake: "Moving between unrelated points or using conversational phrasing in place of analysis."
      }
    ]
  }
};

export function getWritingGuidelines(promptType: string, isSenior?: boolean): WritingSection | undefined {
  if (isSenior && SENIOR_WRITING_GUIDELINES[promptType]) {
    return SENIOR_WRITING_GUIDELINES[promptType];
  }
  return WRITING_GUIDELINES[promptType];
}
