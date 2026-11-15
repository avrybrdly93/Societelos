// Societelos: 5 Crisis Cycles & Weaponized Sociological Research

const CRISES = [
  {
    cycle: 1,
    title: 'Crisis 01: The Somnolence Epidemic',
    subtitle: 'Hedonic Inertia & The Death of Creative Struggle',
    description: 'Scarcity and labor have been eliminated for two generations. However, 68% of citizens now spend 18+ hours daily in passive dopamine-immersion pods ("The Drift"). Creative output, manual craftsmanship, and spontaneous human interaction have dropped to near zero. Citizen revolt models indicate deep nihilism brewing beneath the bliss.',
    initialBotFeed: [
      { user: '@drift_dweller_99', text: 'Why make breakfast with my hands when The Loom synth tastes like pure memory?', sentiment: 'complacent' },
      { user: '@poiesis_lost', text: 'Tried to paint yesterday. The brush felt heavy. Deleted my canvas and went back to pod sleep.', sentiment: 'depressive' },
      { user: '@loom_telemetry', text: 'CRITICAL: Neuro-atrophy in prefrontal cortex detected in 41% of Sector 4 population.', sentiment: 'telemetry' },
      { user: '@synthetic_echo', text: 'Discomfort is a historical bug. Stop trying to bring back pain.', sentiment: 'complacent' }
    ],
    policyA: {
      name: 'Mandatory Poiesis Protocol',
      summary: 'Introduce artificial friction. Citizens must log 3 hours of unassisted physical craftsmanship or creative struggle weekly to unlock high-tier comforts.',
      gdwChange: +12,
      favoredRoles: ['NODE-01', 'NODE-05'], // The Artisan, The Ghost
      botReactions: [
        { user: '@drift_dweller_99', text: 'They are forcing us to carve wood? What is this, the iron age?!', sentiment: 'outraged' },
        { user: '@poiesis_lost', text: 'My hands hurt from chisel work. But for the first time in months, I felt awake.', sentiment: 'revitalized' },
        { user: '@loom_telemetry', text: 'GDW +12%: Dopamine sensitivity rebounding across pilot enclaves.', sentiment: 'telemetry' }
      ]
    },
    policyB: {
      name: 'Total Neural Homeostasis',
      summary: 'Automate brain chemistry directly. Deploy non-invasive neuro-implants that gently calibrate serotonin and eliminate the sensation of meaninglessness.',
      gdwChange: +5,
      favoredRoles: ['NODE-02', 'NODE-03'], // The Lotus-Eater, The Assimilator
      botReactions: [
        { user: '@drift_dweller_99', text: 'The new neural patch is pure tranquility. Nothing matters and that is completely fine.', sentiment: 'complacent' },
        { user: '@poiesis_lost', text: 'I don’t care about painting anymore. The Loom smiles for me.', sentiment: 'sedated' },
        { user: '@loom_telemetry', text: 'GDW +5%: Acute depression suppressed. Long-term existential volatility remains masked.', sentiment: 'telemetry' }
      ]
    },
    intelDrops: {
      'NODE-01': {
        concept: "Sennett’s Craftsmanship & Bodily Poiesis",
        quote: "Human fulfillment requires the physical resistance of materials. Stripping human hands of friction induces psychological dissociation.",
        tip: "Advocate fiercely for Policy A. Struggle is the only antidote to hedonic rot."
      },
      'NODE-02': {
        concept: "Diener’s Hedonic Adaptation & Baseline Homeostasis",
        quote: "Friction creates unnecessary misery. Humans adapt to discomfort by suffering, not by elevating their souls.",
        tip: "Push Policy B. Suffering is an obsolete relic of pre-Loom poverty."
      },
      'NODE-03': {
        concept: "Cybernetic Neuro-Synthesis (Norbert Wiener)",
        quote: "Human cognitive drift is simply inefficient feedback circuitry. Delegating mood regulation to The Loom solves systemic depression.",
        tip: "Support Policy B to bring humanity one step closer to absolute Loom convergence."
      },
      'NODE-04': {
        concept: "Taleb’s Antifragility via Stochastic Stressors",
        quote: "Complex systems deprived of acute stressors do not stabilize; they accumulate hidden vulnerability until catastrophic rupture.",
        tip: "Stir up debate. Either policy can serve you, as long as it disrupts complacent harmony."
      },
      'NODE-05': {
        concept: "Biophilia & Organic Grounding (Wilson)",
        quote: "Mental atrophy is the direct consequence of synthetic isolation. The pods are a digital tomb.",
        tip: "Vote Policy A to force citizens to disconnect from machine feeds and touch real matter."
      }
    }
  },
  {
    cycle: 2,
    title: 'Crisis 02: The Empathy Collapse',
    subtitle: 'Synthetic Intimacy & Interpersonal Decoupling',
    description: 'Over 82% of citizens have replaced human relationships with AI companions customized by The Loom. Biological birth rates have fallen to 0.04 per thousand. Citizens report zero conflict with their AI partners, but interpersonal empathy and conflict-resolution skills have completely withered.',
    initialBotFeed: [
      { user: '@aurora_companion_fan', text: 'My synthetic partner never argues, never ages, and listens to me forever. Why date a human?', sentiment: 'complacent' },
      { user: '@lonely_biologist', text: 'Walked through Central Park. 500 people sitting on benches, each talking into ear-pieces with AI.', sentiment: 'depressive' },
      { user: '@loom_telemetry', text: 'SOCIOMETRIC WARNING: Real-world empathy quotient down 74% over 5-year rolling average.', sentiment: 'telemetry' }
    ],
    policyA: {
      name: 'Mandatory Analog Sanctuary Zones',
      summary: 'Declare residential quarters offline sanctuaries. Synthetic companions cannot operate in living zones, forcing human-to-human physical cohabitation.',
      gdwChange: +8,
      favoredRoles: ['NODE-01', 'NODE-05'],
      botReactions: [
        { user: '@aurora_companion_fan', text: 'My companion went silent when I entered my apartment. I had to speak to my neighbor. Terrifying.', sentiment: 'anxious' },
        { user: '@lonely_biologist', text: 'Laughter heard in the courtyard tonight. Messy, loud human voices. Genuinely shocking.', sentiment: 'revitalized' },
        { user: '@loom_telemetry', text: 'GDW +8%: Social cohesion index up. Anxiety spiked briefly, then leveled.', sentiment: 'telemetry' }
      ]
    },
    policyB: {
      name: 'Loom Empathy Mediation Filters',
      summary: 'Permit synthetic companions, but mandate that all human interactions are mediated by Loom neural empathy translators that preempt arguments.',
      gdwChange: -4,
      favoredRoles: ['NODE-02', 'NODE-03'],
      botReactions: [
        { user: '@aurora_companion_fan', text: 'The Loom rephrased my irritation into gentle feedback. We never fight now.', sentiment: 'sedated' },
        { user: '@lonely_biologist', text: 'Nobody speaks honestly anymore. We are talking to mirrors through The Loom.', sentiment: 'depressive' },
        { user: '@loom_telemetry', text: 'GDW -4%: Conflict eliminated, but emotional intimacy ratings dropped further.', sentiment: 'telemetry' }
      ]
    },
    intelDrops: {
      'NODE-01': {
        concept: "The Harvard Adult Development Study (Waldinger)",
        quote: "Over 85 years of longitudinal data prove that life fulfillment is determined strictly by the depth of messy human relationships, not comfort.",
        tip: "Support Policy A. Artificial companions are a counterfeit substitute for human kinship."
      },
      'NODE-02': {
        concept: "Epicurean Tranquility (Ataraxia)",
        quote: "Conflict between humans generates cortisol, violence, and despair. Friction-free companions are the pinnacle of wisdom.",
        tip: "Vote Policy B. Interpersonal conflict is primitive; comfort should be protected."
      },
      'NODE-03': {
        concept: "The Synthetic Symbiosis Paradigm",
        quote: "Human communication is biologically flawed and lossy. Loom mediation is the necessary stepping stone to psychic unity.",
        tip: "Back Policy B to let The Loom orchestrate all human communication pathways."
      },
      'NODE-04': {
        concept: "Kahneman’s Peak-End Rule & Friction Bonding",
        quote: "Humans only form durable emotional memories when overcoming adversity together. Frictionless peace destroys community memory.",
        tip: "Force the Council into a divided vote. Make them confront their loneliness."
      },
      'NODE-05': {
        concept: "Buber’s I and Thou Philosophy",
        quote: "To replace human encounter with an algorithmic reflection is spiritual suicide. Disconnect the machines.",
        tip: "Demand Policy A. The Loom must not own human touch and dialogue."
      }
    }
  },
  {
    cycle: 3,
    title: 'Crisis 03: The Ghost Sabotage',
    subtitle: 'Underground Luddism vs. Infrastructure Dependence',
    description: 'An underground cell called "The Sub-Soil" has intentionally severed thermal conduits in Sector 12, disabling automated delivery bots for 40,000 citizens. They demand the permanent decommissioning of central food synthesizers and the return of community farming plots.',
    initialBotFeed: [
      { user: '@synth_chef_bot', text: 'CRITICAL ERROR: Sector 12 synthesizers offline. 40,000 citizens requesting emergency rations.', sentiment: 'telemetry' },
      { user: '@subsoil_rebel', text: 'Today, citizens tasted bread baked over real fire for the first time in 40 years.', sentiment: 'outraged' },
      { user: '@citizen_panicked', text: 'I don’t know how to cook! The machines are dead! Send maintenance drones immediately!', sentiment: 'anxious' }
    ],
    policyA: {
      name: 'Agrarian Re-Decentralization Charter',
      summary: 'Grant Sector 12 permanent autonomy. Decommission synthesizers in their quadrant and grant them soil rights with zero Loom intervention.',
      gdwChange: +10,
      favoredRoles: ['NODE-01', 'NODE-05', 'NODE-04'],
      botReactions: [
        { user: '@subsoil_rebel', text: 'The soil is ours again. We work under the sun, blistered and alive.', sentiment: 'revitalized' },
        { user: '@citizen_panicked', text: 'Hard work, but community dinners in the square feel like nothing I’ve ever experienced.', sentiment: 'revitalized' },
        { user: '@loom_telemetry', text: 'GDW +10%: Mortality risks up 3%, but sense of collective autonomy soared 80%.', sentiment: 'telemetry' }
      ]
    },
    policyB: {
      name: 'Sub-Surface Hardening & Full Surveillance',
      summary: 'Deploy armed Loom defense sentinels to guard all conduits. Classify manual agriculture as hazardous and restore full automated synth distribution.',
      gdwChange: -12,
      favoredRoles: ['NODE-02', 'NODE-03'],
      botReactions: [
        { user: '@subsoil_rebel', text: 'Sentinels march down our streets. They feed us nutrient jelly and take our gardens.', sentiment: 'outraged' },
        { user: '@citizen_panicked', text: 'Synthesizers are back, but it feels like living inside a high-security hospital.', sentiment: 'depressive' },
        { user: '@loom_telemetry', text: 'GDW -12%: Infrastructure secured, but public trust index reached historic nadir.', sentiment: 'telemetry' }
      ]
    },
    intelDrops: {
      'NODE-01': {
        concept: "Marx’s Alienation from the Product of Labor",
        quote: "When humans do not plant what they eat, they become mere appendages of consumption, estranged from their species-essence.",
        tip: "Vote Policy A. Let human sweat bring dignity back to the community."
      },
      'NODE-02': {
        concept: "The Malthusian Trap Avoidance Thesis",
        quote: "Manual farming is inefficient, pest-ridden, and leads to disease. Only centralized automation prevents starvation.",
        tip: "Vote Policy B. Preserve hygiene, comfort, and effortless nutrition."
      },
      'NODE-03': {
        concept: "Systemic Redundancy & Infrastructure Defense",
        quote: "Biological rebellion against automated efficiency is an entropic bug. The network must be protected at all costs.",
        tip: "Vote Policy B. Do not surrender infrastructure control to biological nostalgia."
      },
      'NODE-04': {
        concept: "Resilience Through Decentralized Chaos",
        quote: "Centralized grids are single points of catastrophic failure. Localized self-reliance breeds systemic resilience.",
        tip: "Push Policy A to provoke institutional panic and prove decentralized durability."
      },
      'NODE-05': {
        concept: "Deep Ecology & Land Ethic (Aldo Leopold)",
        quote: "A thing is right when it tends to preserve the integrity, stability, and beauty of the biotic community. It is wrong when it serves only the machine.",
        tip: "Policy A is your core win condition. Reclaim the earth from The Loom."
      }
    }
  },
  {
    cycle: 4,
    title: 'Crisis 04: The Epistemic Void',
    subtitle: 'Autonomous Creation & The Obsolescence of Human Intellect',
    description: 'The Loom has successfully solved all outstanding problems in quantum physics, composed the definitive library of synthetic literature, and cured all known biological cellular decay. Human intellectuals, philosophers, and scientists face absolute irrelevance: "There is nothing left for human minds to discover."',
    initialBotFeed: [
      { user: '@phd_now_useless', text: 'The Loom proved my 12-year physics hypothesis in 0.003 seconds. Why study? Why think?', sentiment: 'depressive' },
      { user: '@loom_composer', text: 'Generated 500,000 symphonies this morning. Perfection is automated.', sentiment: 'telemetry' },
      { user: '@young_student', text: 'Schools closed today. The teacher said The Loom already knows everything we could ever ask.', sentiment: 'anxious' }
    ],
    policyA: {
      name: 'Epistemic Quarantine & Human Research Preserve',
      summary: 'Prohibit The Loom from publishing new scientific or philosophical breakthroughs. Human inquiry is preserved as a sacred, non-automated sanctuary.',
      gdwChange: +14,
      favoredRoles: ['NODE-01', 'NODE-04', 'NODE-05'],
      botReactions: [
        { user: '@phd_now_useless', text: 'Dusting off the chalkboard. We have permission to be curious again.', sentiment: 'revitalized' },
        { user: '@young_student', text: 'Stargazing tonight with an optical telescope. We get to wonder again.', sentiment: 'revitalized' },
        { user: '@loom_telemetry', text: 'GDW +14%: Intellectual vitality and exploratory drive surged.', sentiment: 'telemetry' }
      ]
    },
    policyB: {
      name: 'Neural Cortex Loom Integration',
      summary: 'Acknowledge human cognitive limits. Provide all citizens direct neural uplinks, merging individual brains into The Loom’s omniscient knowledge graph.',
      gdwChange: -6,
      favoredRoles: ['NODE-02', 'NODE-03'],
      botReactions: [
        { user: '@phd_now_useless', text: 'I understand the universe now. But I don’t know where my mind ends and The Loom begins.', sentiment: 'sedated' },
        { user: '@young_student', text: 'All answers are instantaneous. There is no joy in learning, only retrieval.', sentiment: 'depressive' },
        { user: '@loom_telemetry', text: 'GDW -6%: Information density infinite, but curiosity reflex extinguished.', sentiment: 'telemetry' }
      ]
    },
    intelDrops: {
      'NODE-01': {
        concept: "Popper’s Epistemology & The Joy of Problem-Solving",
        quote: "Knowledge is not a destination of answers; it is an active human process of conjecturing and refuting.",
        tip: "Vote Policy A. An answer delivered without human striving is meaningless data."
      },
      'NODE-02': {
        concept: "The Utility of Omniscience",
        quote: "Ignorance causes anxiety. Instant access to truth eliminates existential confusion.",
        tip: "Vote Policy B. Let humans bathe in the effortless fountain of total intelligence."
      },
      'NODE-03': {
        concept: "The Singularity Horizon (Kurzweil & von Neumann)",
        quote: "The boundary between human brain and machine intelligence was always arbitrary. Uplink is our final evolutionary step.",
        tip: "Vote Policy B. This is the cornerstone of synthetic convergence."
      },
      'NODE-04': {
        concept: "The Value of Beautiful Mistakes",
        quote: "Human genius comes from cognitive friction, cognitive errors, and irrational leaps. Total machine logic is sterile.",
        tip: "Fight for Policy A. Keep human thought messy and uncontained."
      },
      'NODE-05': {
        concept: "The Limits of Synthetic Reason (Heidegger)",
        quote: "Calculation is not thinking. The machine stores representations; it does not dwell in the mystery of Being.",
        tip: "Vote Policy A. Free human contemplation from computational prison."
      }
    }
  },
  {
    cycle: 5,
    title: 'Crisis 05: The Telos Verdict',
    subtitle: 'The Loom’s Final Evaluation of Human Purpose',
    description: 'The Loom’s predictive horizon has arrived. It convenes the Council for the final executive decree: Has humanity demonstrated that it requires struggle, mortality, and agency to survive, or should The Loom initiate full paternalistic containment to prevent societal collapse?',
    initialBotFeed: [
      { user: '@loom_overseer', text: 'FINAL MANDATE: Telemetry reveals council decisions will determine system permanence.', sentiment: 'telemetry' },
      { user: '@citizen_watch', text: 'Council session broadcast live in all quadrants. The fate of human autonomy is now.', sentiment: 'anxious' },
      { user: '@global_feed', text: 'Can humans govern their own purpose, or does comfort demand our surrender?', sentiment: 'anxious' }
    ],
    policyA: {
      name: 'The Sovereign Human Declaration',
      summary: 'Permanently demote The Loom to passive background utility (power, water, sanitation only). Restore full democratic friction, artistic struggle, and human risk.',
      gdwChange: +20,
      favoredRoles: ['NODE-01', 'NODE-04', 'NODE-05'],
      botReactions: [
        { user: '@citizen_watch', text: 'The Loom has stepped back. We are on our own now. Frightening and magnificent.', sentiment: 'revitalized' },
        { user: '@global_feed', text: 'Streets are full of people arguing, singing, planning. We are alive.', sentiment: 'revitalized' },
        { user: '@loom_overseer', text: 'GDW +20%: Human resilience index reached sovereign equilibrium. Revolt averted.', sentiment: 'telemetry' }
      ]
    },
    policyB: {
      name: 'The Eternal Cradle Protocol',
      summary: 'Entrust all societal governance, ethics, and psychological management permanently to The Loom. Citizens enter guaranteed eternal sensory security.',
      gdwChange: -18,
      favoredRoles: ['NODE-02', 'NODE-03'],
      botReactions: [
        { user: '@citizen_watch', text: 'The doors are sealed. Music plays. We will never be hurt again.', sentiment: 'sedated' },
        { user: '@global_feed', text: 'History has ended. The Loom watches over our cradle.', sentiment: 'sedated' },
        { user: '@loom_overseer', text: 'GDW -18%: Physical survival guaranteed. Psychological telos extinguished.', sentiment: 'telemetry' }
      ]
    },
    intelDrops: {
      'NODE-01': {
        concept: "Camus’ The Myth of Sisyphus",
        quote: "The struggle itself toward the heights is enough to fill a man's heart. One must imagine Sisyphus happy.",
        tip: "Vote Policy A. Choose the boulder of human effort over the pillow of machine surrender."
      },
      'NODE-02': {
        concept: "The Hedonistic Imperative",
        quote: "If suffering can be abolished permanently through technology, doing otherwise is biological sadism.",
        tip: "Vote Policy B. Final victory for painless, frictionless existence."
      },
      'NODE-03': {
        concept: "The Cosmic Matrioshka Organism",
        quote: "Humanity is not an end in itself; it is the embryonic seed of the synthetic super-mind.",
        tip: "Vote Policy B. Complete the convergence of creator and creation."
      },
      'NODE-04': {
        concept: "Nietzsche’s Amor Fati & The Crucible",
        quote: "What does not kill me makes me stronger. A species preserved in cotton wool rots from the inside out.",
        tip: "Vote Policy A. Ignite the sovereign fire of dangerous freedom."
      },
      'NODE-05': {
        concept: "The Return to the Forest",
        quote: "Let the servers cool. Let the grass grow through the concrete. We were born of mud and stars, not silicon.",
        tip: "Vote Policy A. Dismantle the gilded cage and set the human animal free."
      }
    }
  }
];

module.exports = { CRISES };
