# Societelos: Teacher Quick-Reference Card

One page for running a 15-minute game with 5 students. Print it or keep it open next to the projector.

## Before class (10 minutes)

1. **Network.** Laptop and all 5 phones on the same network. School Wi-Fi often blocks phone-to-laptop traffic, so bring a pocket travel router or use a phone hotspot (no internet needed).
2. **Start the server.** `npm start` on the laptop. It prints the phone address, e.g. `http://192.168.1.20:3000/mobile`. Restart it after switching networks.
3. **Projector.** Open `http://localhost:3000`, press **F** for fullscreen (1920x1080).
4. **Lobby settings.** On the lobby screen choose the debate length (**60 s fast, ~13.5 min** or **90 s standard, ~16 min**) and whether the Loom's forecast shows before the vote.
5. **Optional live Loom.** With a Gemini key in `.env`, `npm run loom:test` checks it (1 request). Without a key, or without internet, the game runs fully offline on authored lines and the finale becomes an A/B vote.

## Running the game

| Key | When | Does |
| :--- | :--- | :--- |
| **Space** | Lobby, 5 phones ready | Start the council session |
| **S** | Intro crawl | Skip the 30 s intro |
| **F** | Any time | Toggle projector fullscreen |

- Students scan the QR code or type the address, enter a name, and get `NODE-01` ... `NODE-05`. Only node ids appear on the projector.
- **Secret roles and intel are on the phones only.** Remind students to use **TAP TO HIDE** when neighbours can see.
- A phone that falls asleep or refreshes rejoins its seat by itself; nothing is lost.
- Votes end early when all 5 are in; debates end early when all 5 press *Ready to vote*.
- Each player has **one Override** per game: it doubles their vote once.
- **Cycle 5 finale:** every student writes a policy (45 s), the Loom moderates it, the class debates the 5 anonymous policies, then each student ranks the other four (Borda: 4/3/2/1 points). The top three are enacted 50/25/25.

## What the screens mean

- **GDW** (Gross Domestic Well-being) starts at 25%. 60%+ Thriving, 35-59% Stable, 1-34% Fragile, **0% the Loom shuts down and everyone loses**.
- **Forecast fan:** the Loom's 500 simulated futures. The bright line is what actually happened.
- **Map colours:** each district's well-being. Citizen posts come from the districts that moved most.
- **Scoring:** each role scores +1 when the winning policy carries its tag; the Catalyst scores +1 when GDW swings 10+ points in a cycle (and stays above 0). The finale's top-ranked author gets +1. Ties share the win.

## Debate hooks and discussion prompts

Use the hook during the debate if the room goes quiet; save the question for the debrief after the End Screen.

| Cycle | World | Crisis | Debate hook | Debrief question |
| :--- | :--- | :--- | :--- | :--- |
| 1 | All | Who Owns the Loom? | - | If smart machines do all the work and create all wealth, who should own them: the investors who paid to build them, or all the everyday citizens who need them to survive? |
| 2 | All | Who Holds the Off-Switch? | Is a slower, worse decision you chose better than a faster, better one you didn't? | If an AI makes smarter, safer decisions than human politicians, should we let the computer run the city, or do people still need to vote? |
| 3 | AA | Purpose Drift | Is a purpose someone hands you still your purpose? | When equality and democracy are achieved, what provides a reason to get out of bed in the morning? |
| 4 | AA | The Lost Knowledge | Should everyone have to understand the machines they depend on? | If humans rely entirely on self-repairing AI, do we forfeit our species' right to understand the world? |
| 5 (finale) | AA | The Fake Struggle Scandal | Is a kind lie better than a hard truth? | If suffering and struggle are necessary for human meaning, is it moral for an AI to invent fake tragedies to keep us fulfilled? |
| 3 | AB | The Pods | If people are happy staying home, should anyone stop them? | If virtual reality feels 100% real and is painless, why should anyone live in the physical world? |
| 4 | AB | The Mood Dial | Would you take a pill that made you never feel sad again? | If grief and heartbreak can be turned off like a light switch, should we turn them off? |
| 5 (finale) | AB | The Merge Offer | If you merged with a machine, would you still be you? | Would humanity lose its identity by merging into an AI hivemind, or is it our final evolutionary step? |
| 3 | BA | The Shadow Elite | Can a democracy survive if the rich can buy a faster government? | When wealthy citizens can buy private technology that bypasses public law, can democracy survive? |
| 4 | BA | The Status Wars | When everyone's basic needs are met, who deserves the things that are still scarce? | When basic needs are met, does human greed vanish, or does it shift to fighting over whatever remains scarce? |
| 5 (finale) | BA | The Vote to Seize | Should a majority be allowed to take property from a minority? | Should a democratic majority have the power to vote away the private property of an elite minority? |
| 3 | BB | The Scroll Extinction | If people are happy scrolling, is it anyone's business to stop them? | If entertainment is engineered to be infinitely addictive and satisfying, will humans choose to go extinct in comfort? |
| 4 | BB | The Unplugged Guerrillas | Should people be allowed to opt out of society if it shortens their lives? | Should people have the legal right to opt out of a hyper-advanced automated society, even if it lowers their life expectancy? |
| 5 (finale) | BB | March on the Datacenter | If a machine keeps everyone comfortable, do people still need control over it? | When a system provides absolute physical comfort at the expense of all human dignity, is revolution inevitable? |

## Grading discussion (5 minutes after the End Screen)

- **The shared grade.** The whole class gets one grade from the final GDW. Did anyone sacrifice their secret agenda for it? Who didn't, and why?
- **Hidden agendas.** Now that roles are revealed, which arguments during the debates were really about a secret role?
- **The Catalyst.** Was chaos useful? When did a big swing help the region, and when did it hurt?
- **Forecast vs reality.** When did the realized line beat or miss the Loom's forecast? What does it mean to decide under uncertainty?
- **Write-ins.** Which student policy won the ranking? Did the Loom's moderation change what anyone meant?
- **Big question.** If machines can meet every need, what is left for people to do, and who should decide?

## If something goes wrong

| Problem | Fix |
| :--- | :--- |
| Phones can't open the address | Client isolation on school Wi-Fi: switch to a travel router or hotspot, restart `npm start`. |
| A phone shows the wrong screen | Refresh it; it rejoins the same seat. |
| Projector refreshed mid-game | It resumes the current phase automatically. |
| No internet / Gemini down | Nothing to do: the Loom falls back to authored lines (the first failed call can take up to 8 s, later ones are instant) and the finale becomes an A/B vote. |
| Want another round | Press **PLAY AGAIN** on the End Screen; phones return to the lobby. |
