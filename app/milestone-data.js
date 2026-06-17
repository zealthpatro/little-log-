/* Cubby developmental milestones. Sources in MILESTONES.md.
   Clinical entries are CDC (Learn the Signs, 2022 revision) / WHO; framing is reassurance-only.
   Delight / firsts entries are non-clinical keepsakes: no source, no band, no clinical weight.
   Field shape:
     key (stable, unique, lowercase), title (display), type ('clinical'|'delight'),
     domain, cat (short human chip label), mo (typical month, integer, always present),
     band [minMo,maxMo] (clinical only), source ('CDC 2022'|'WHO', clinical only),
     doctorNote (optional, only where CDC flags an act-early note, worded gently),
     context ('pet'|'travel'|'people', optional), region (country codes, optional),
     emoji (optional, delight cards).
   Existing keys are preserved exactly so logged milestones keep referencing them. */
window.MILESTONES = [

  /* ============================================================
     EXISTING ENTRIES (keys preserved exactly, re-tagged additively)
     ============================================================ */
  {key:'smile', title:'First social smile', type:'clinical', domain:'social-emotional', cat:'Social', mo:2, band:[1,4], source:'CDC 2022'},
  {key:'coo', title:'Coos and gurgles', type:'clinical', domain:'language', cat:'Language', mo:2, band:[2,4], source:'CDC 2022'},
  {key:'headup', title:'Holds head steady', type:'clinical', domain:'motor-gross', cat:'Movement', mo:3, band:[2,4], source:'WHO'},
  {key:'laugh', title:'First laugh', type:'clinical', domain:'social-emotional', cat:'Social', mo:4, band:[3,6], source:'CDC 2022'},
  {key:'roll', title:'Rolls over', type:'clinical', domain:'motor-gross', cat:'Movement', mo:4, band:[4,6], source:'CDC 2022'},
  {key:'reach', title:'Reaches for toys', type:'clinical', domain:'motor-fine', cat:'Movement', mo:5, band:[4,6], source:'CDC 2022'},
  {key:'sit', title:'Sits without support', type:'clinical', domain:'motor-gross', cat:'Movement', mo:6, band:[6,9], source:'WHO'},
  {key:'solids', title:'First solid foods', type:'delight', domain:'firsts', cat:'Growth', mo:6, emoji:'🥣'},
  {key:'tooth', title:'First tooth! 🦷', type:'delight', domain:'teeth', cat:'Teeth', mo:7, emoji:'🦷'},
  {key:'teeth2', title:'Two teeth', type:'delight', domain:'teeth', cat:'Teeth', mo:8},
  {key:'teeth4', title:'Four teeth', type:'delight', domain:'teeth', cat:'Teeth', mo:11},
  {key:'molar', title:'First molar', type:'delight', domain:'teeth', cat:'Teeth', mo:14},
  {key:'teeth8', title:'Eight teeth', type:'delight', domain:'teeth', cat:'Teeth', mo:16},
  {key:'teethfull', title:'Full set of 20', type:'delight', domain:'teeth', cat:'Teeth', mo:30},
  {key:'babble', title:'Babbles (ba-ba, da-da)', type:'clinical', domain:'language', cat:'Language', mo:7, band:[6,9], source:'CDC 2022'},
  {key:'crawl', title:'Starts crawling', type:'clinical', domain:'motor-gross', cat:'Movement', mo:8, band:[6,11], source:'WHO'},
  {key:'clap', title:'Claps hands 👏', type:'delight', domain:'social-emotional', cat:'Fun', mo:9, emoji:'👏'},
  {key:'pull', title:'Pulls up to stand', type:'clinical', domain:'motor-gross', cat:'Movement', mo:9, band:[8,12], source:'CDC 2022'},
  {key:'wave', title:'Waves bye-bye', type:'clinical', domain:'social-emotional', cat:'Social', mo:9, band:[9,15], source:'CDC 2022'},
  {key:'pincer', title:'Pincer grasp (finger food)', type:'clinical', domain:'motor-fine', cat:'Movement', mo:10, band:[9,12], source:'CDC 2022'},
  {key:'kiss', title:'Blows kisses 😘', type:'delight', domain:'social-emotional', cat:'Fun', mo:11, emoji:'😘'},
  {key:'cruise', title:'Cruises along furniture', type:'clinical', domain:'motor-gross', cat:'Movement', mo:11, band:[9,13], source:'CDC 2022'},
  {key:'firstword', title:'First word', type:'clinical', domain:'language', cat:'Language', mo:12, band:[10,15], source:'CDC 2022'},
  {key:'stand', title:'Stands alone', type:'clinical', domain:'motor-gross', cat:'Movement', mo:12, band:[10,15], source:'WHO'},
  {key:'walk', title:'First steps / walks', type:'clinical', domain:'motor-gross', cat:'Movement', mo:13, band:[12,18], source:'WHO', doctorNote:'If your little one is not walking on their own by 18 months, it is worth a gentle chat with your doctor. Many late walkers are perfectly fine.'},
  {key:'dance', title:'Dances to music 🎵', type:'delight', domain:'social-emotional', cat:'Fun', mo:13, emoji:'🎵'},
  {key:'point', title:'Points at things', type:'clinical', domain:'social-emotional', cat:'Language', mo:14, band:[12,18], source:'CDC 2022', doctorNote:'Pointing to share interest usually appears by around 18 months. If it has not yet, mention it at your next visit.'},
  {key:'sleepnight', title:'Sleeps through the night', type:'delight', domain:'firsts', cat:'Sleep', mo:6, emoji:'🌙'},
  {key:'spoon', title:'Self-feeds with a spoon', type:'clinical', domain:'self-care', cat:'Self-care', mo:15, band:[15,24], source:'CDC 2022'},
  {key:'words', title:'Says several words', type:'clinical', domain:'language', cat:'Language', mo:15, band:[15,21], source:'CDC 2022'},
  {key:'stack', title:'Stacks blocks', type:'clinical', domain:'motor-fine', cat:'Fun', mo:16, band:[15,21], source:'CDC 2022'},
  {key:'climb', title:'Climbs stairs', type:'clinical', domain:'motor-gross', cat:'Movement', mo:18, band:[16,24], source:'CDC 2022'},
  {key:'run', title:'Runs', type:'clinical', domain:'motor-gross', cat:'Movement', mo:20, band:[18,24], source:'CDC 2022'},
  {key:'phrases', title:'Two-word phrases', type:'clinical', domain:'language', cat:'Language', mo:24, band:[21,30], source:'CDC 2022', doctorNote:'Most toddlers put two words together by around 2 years. If not yet, your doctor can help you support language at home.'},

  /* ============================================================
     CLINICAL  (CDC 2022 surveillance + WHO gross-motor)
     Reassurance framing: "around now, most babies"; never "behind".
     band = the gentle range. doctorNote only where CDC flags act-early.
     ============================================================ */

  /* --- 2 months --- */
  {key:'cl-2-watchface', title:'Watches you as you move', type:'clinical', domain:'cognitive', cat:'Social', mo:2, band:[2,4], source:'CDC 2022'},
  {key:'cl-2-calmtovoice', title:'Calms when picked up or spoken to', type:'clinical', domain:'social-emotional', cat:'Social', mo:2, band:[1,4], source:'CDC 2022'},
  {key:'cl-2-soundsother', title:'Makes sounds other than crying', type:'clinical', domain:'language', cat:'Language', mo:2, band:[2,4], source:'CDC 2022'},
  {key:'cl-2-headuptummy', title:'Lifts head during tummy time', type:'clinical', domain:'motor-gross', cat:'Movement', mo:2, band:[2,4], source:'CDC 2022'},

  /* --- 4 months --- */
  {key:'cl-4-spontsmile', title:'Smiles to get your attention', type:'clinical', domain:'social-emotional', cat:'Social', mo:4, band:[3,6], source:'CDC 2022'},
  {key:'cl-4-coosback', title:'Coos and makes sounds back to you', type:'clinical', domain:'language', cat:'Language', mo:4, band:[3,6], source:'CDC 2022'},
  {key:'cl-4-holdshead', title:'Holds head steady when held', type:'clinical', domain:'motor-gross', cat:'Movement', mo:4, band:[3,6], source:'CDC 2022'},
  {key:'cl-4-pushupelbows', title:'Pushes up on elbows in tummy time', type:'clinical', domain:'motor-gross', cat:'Movement', mo:4, band:[4,6], source:'CDC 2022'},

  /* --- 6 months --- */
  {key:'cl-6-knowsfamiliar', title:'Knows familiar faces', type:'clinical', domain:'social-emotional', cat:'Social', mo:6, band:[6,9], source:'CDC 2022'},
  {key:'cl-6-takesturns', title:'Takes turns making sounds with you', type:'clinical', domain:'language', cat:'Language', mo:6, band:[6,9], source:'CDC 2022'},
  {key:'cl-6-mouththings', title:'Puts things in mouth to explore', type:'clinical', domain:'cognitive', cat:'Social', mo:6, band:[6,9], source:'CDC 2022'},
  {key:'cl-6-reachgrab', title:'Reaches to grab a toy they want', type:'clinical', domain:'cognitive', cat:'Movement', mo:6, band:[6,9], source:'CDC 2022'},
  {key:'cl-6-rollsboth', title:'Rolls from tummy to back', type:'clinical', domain:'motor-gross', cat:'Movement', mo:6, band:[5,8], source:'CDC 2022'},
  {key:'cl-6-sitassist', title:'Sits with a little support', type:'clinical', domain:'motor-gross', cat:'Movement', mo:6, band:[5,8], source:'WHO'},

  /* --- 9 months --- */
  {key:'cl-9-shy', title:'Shy or clingy with strangers', type:'clinical', domain:'social-emotional', cat:'Social', mo:9, band:[8,12], source:'CDC 2022'},
  {key:'cl-9-looksname', title:'Looks when you call their name', type:'clinical', domain:'language', cat:'Language', mo:9, band:[8,12], source:'CDC 2022'},
  {key:'cl-9-looksfall', title:'Looks for things you hide', type:'clinical', domain:'cognitive', cat:'Social', mo:9, band:[8,12], source:'CDC 2022'},
  {key:'cl-9-handsknees', title:'Gets onto hands and knees', type:'clinical', domain:'motor-gross', cat:'Movement', mo:9, band:[7,11], source:'WHO'},
  {key:'cl-9-sitsalone', title:'Sits without support', type:'clinical', domain:'motor-gross', cat:'Movement', mo:9, band:[6,9], source:'WHO'},

  /* --- 12 months --- */
  {key:'cl-12-playsgames', title:'Plays games like pat-a-cake', type:'clinical', domain:'social-emotional', cat:'Social', mo:12, band:[10,15], source:'CDC 2022'},
  {key:'cl-12-wavesbye', title:'Waves bye-bye on their own', type:'clinical', domain:'social-emotional', cat:'Social', mo:12, band:[9,15], source:'CDC 2022'},
  {key:'cl-12-callsparent', title:'Calls a parent mama or dada', type:'clinical', domain:'language', cat:'Language', mo:12, band:[10,15], source:'CDC 2022'},
  {key:'cl-12-pullstand', title:'Pulls up to stand', type:'clinical', domain:'motor-gross', cat:'Movement', mo:12, band:[9,14], source:'CDC 2022'},
  {key:'cl-12-walksassist', title:'Walks holding on to furniture', type:'clinical', domain:'motor-gross', cat:'Movement', mo:12, band:[9,14], source:'WHO'},

  /* --- 15 months --- */
  {key:'cl-15-copiesyou', title:'Copies other children while playing', type:'clinical', domain:'social-emotional', cat:'Social', mo:15, band:[15,21], source:'CDC 2022'},
  {key:'cl-15-triesword', title:'Tries to say one or two words besides mama and dada', type:'clinical', domain:'language', cat:'Language', mo:15, band:[15,21], source:'CDC 2022'},
  {key:'cl-15-stacks2', title:'Stacks two small blocks', type:'clinical', domain:'motor-fine', cat:'Fun', mo:15, band:[15,21], source:'CDC 2022'},
  {key:'cl-15-fewsteps', title:'Takes a few steps on their own', type:'clinical', domain:'motor-gross', cat:'Movement', mo:15, band:[12,18], source:'CDC 2022'},
  {key:'cl-15-fingerfeeds', title:'Feeds themselves with fingers', type:'clinical', domain:'self-care', cat:'Self-care', mo:15, band:[15,21], source:'CDC 2022'},

  /* --- 18 months --- */
  {key:'cl-18-pointsshow', title:'Points to show you something interesting', type:'clinical', domain:'social-emotional', cat:'Social', mo:18, band:[15,21], source:'CDC 2022'},
  {key:'cl-18-saysseveral', title:'Tries to say three or more words', type:'clinical', domain:'language', cat:'Language', mo:18, band:[18,24], source:'CDC 2022'},
  {key:'cl-18-followsone', title:'Follows one-step directions without a gesture', type:'clinical', domain:'language', cat:'Language', mo:18, band:[18,24], source:'CDC 2022'},
  {key:'cl-18-walksalone', title:'Walks on their own', type:'clinical', domain:'motor-gross', cat:'Movement', mo:18, band:[12,18], source:'WHO'},
  {key:'cl-18-scribbles', title:'Scribbles with a crayon', type:'clinical', domain:'motor-fine', cat:'Fun', mo:18, band:[18,24], source:'CDC 2022'},
  {key:'cl-18-undresses', title:'Helps take off loose clothes', type:'clinical', domain:'self-care', cat:'Self-care', mo:18, band:[18,30], source:'CDC 2022'},

  /* --- 24 months --- */
  {key:'cl-24-noticesupset', title:'Notices when others are hurt or upset', type:'clinical', domain:'social-emotional', cat:'Social', mo:24, band:[21,30], source:'CDC 2022'},
  {key:'cl-24-pointsbook', title:'Points to things in a book when asked', type:'clinical', domain:'language', cat:'Language', mo:24, band:[21,30], source:'CDC 2022'},
  {key:'cl-24-kicksball', title:'Kicks a ball', type:'clinical', domain:'motor-gross', cat:'Movement', mo:24, band:[21,30], source:'CDC 2022'},
  {key:'cl-24-runseasy', title:'Runs', type:'clinical', domain:'motor-gross', cat:'Movement', mo:24, band:[18,30], source:'CDC 2022'},
  {key:'cl-24-eatsspoon', title:'Eats with a spoon', type:'clinical', domain:'self-care', cat:'Self-care', mo:24, band:[21,30], source:'CDC 2022'},

  /* --- 30 months --- */
  {key:'cl-30-playsnearby', title:'Plays next to other children, sometimes with them', type:'clinical', domain:'social-emotional', cat:'Social', mo:30, band:[30,36], source:'CDC 2022'},
  {key:'cl-30-followssteps', title:'Follows two-step directions', type:'clinical', domain:'language', cat:'Language', mo:30, band:[30,36], source:'CDC 2022'},
  {key:'cl-30-says50', title:'Says about 50 words', type:'clinical', domain:'language', cat:'Language', mo:30, band:[30,36], source:'CDC 2022', doctorNote:'Vocabulary really takes off around this age. If word use seems very limited, your doctor can guide you.'},
  {key:'cl-30-twothings', title:'Says two or more words together, with one action word', type:'clinical', domain:'language', cat:'Language', mo:30, band:[30,36], source:'CDC 2022'},
  {key:'cl-30-usesthings', title:'Uses things to pretend', type:'clinical', domain:'cognitive', cat:'Fun', mo:30, band:[30,36], source:'CDC 2022'},
  {key:'cl-30-jumpsoff', title:'Jumps off the ground with both feet', type:'clinical', domain:'motor-gross', cat:'Movement', mo:30, band:[28,36], source:'CDC 2022'},

  /* --- 36 months (3 years) --- */
  {key:'cl-36-calmsday', title:'Calms within ten minutes after you leave at daycare', type:'clinical', domain:'social-emotional', cat:'Social', mo:36, band:[36,48], source:'CDC 2022'},
  {key:'cl-36-talksconvo', title:'Talks with you in conversation with two back-and-forths', type:'clinical', domain:'language', cat:'Language', mo:36, band:[36,48], source:'CDC 2022'},
  {key:'cl-36-askswhat', title:'Asks who, what, where or why questions', type:'clinical', domain:'language', cat:'Language', mo:36, band:[36,48], source:'CDC 2022'},
  {key:'cl-36-talksclear', title:'Talks well enough for others to understand most of the time', type:'clinical', domain:'language', cat:'Language', mo:36, band:[36,48], source:'CDC 2022', doctorNote:'By age three, most people can understand much of what a child says. If speech is hard to follow, a hearing and speech check can help.'},
  {key:'cl-36-drawscircle', title:'Draws a circle when you show them how', type:'clinical', domain:'motor-fine', cat:'Fun', mo:36, band:[36,48], source:'CDC 2022'},
  {key:'cl-36-usesfork', title:'Uses a fork', type:'clinical', domain:'self-care', cat:'Self-care', mo:36, band:[36,48], source:'CDC 2022'},

  /* --- 48 months (4 years) --- */
  {key:'cl-48-pretendplay', title:'Pretends to be something else during play', type:'clinical', domain:'social-emotional', cat:'Fun', mo:48, band:[48,60], source:'CDC 2022'},
  {key:'cl-48-avoidsdanger', title:'Avoids danger, like not jumping from somewhere high', type:'clinical', domain:'cognitive', cat:'Self-care', mo:48, band:[48,60], source:'CDC 2022'},
  {key:'cl-48-saysword', title:'Says sentences with four or more words', type:'clinical', domain:'language', cat:'Language', mo:48, band:[48,60], source:'CDC 2022'},
  {key:'cl-48-tellsstory', title:'Talks about at least one thing that happened during the day', type:'clinical', domain:'language', cat:'Language', mo:48, band:[48,60], source:'CDC 2022'},
  {key:'cl-48-drawsperson', title:'Draws a person with three or more body parts', type:'clinical', domain:'motor-fine', cat:'Fun', mo:48, band:[48,60], source:'CDC 2022'},
  {key:'cl-48-catchesball', title:'Catches a large ball most of the time', type:'clinical', domain:'motor-gross', cat:'Movement', mo:48, band:[48,60], source:'CDC 2022'},
  {key:'cl-48-servesfood', title:'Serves themselves food with a little supervision', type:'clinical', domain:'self-care', cat:'Self-care', mo:48, band:[48,60], source:'CDC 2022'},

  /* --- 60 months (5 years) --- */
  {key:'cl-60-followsrules', title:'Follows rules or takes turns in simple games', type:'clinical', domain:'social-emotional', cat:'Social', mo:60, band:[60,72], source:'CDC 2022'},
  {key:'cl-60-tellsstoryfull', title:'Tells a story they heard or made up, with two or more events', type:'clinical', domain:'language', cat:'Language', mo:60, band:[60,72], source:'CDC 2022'},
  {key:'cl-60-keepsconvo', title:'Keeps a conversation going with more than three back-and-forths', type:'clinical', domain:'language', cat:'Language', mo:60, band:[60,72], source:'CDC 2022'},
  {key:'cl-60-counts', title:'Counts to ten', type:'clinical', domain:'cognitive', cat:'Language', mo:60, band:[60,72], source:'CDC 2022'},
  {key:'cl-60-writesletters', title:'Writes some letters of their name', type:'clinical', domain:'motor-fine', cat:'Fun', mo:60, band:[60,72], source:'CDC 2022'},
  {key:'cl-60-hopsonefoot', title:'Hops on one foot', type:'clinical', domain:'motor-gross', cat:'Movement', mo:60, band:[60,72], source:'CDC 2022'},

  /* ============================================================
     DELIGHT / FIRSTS  (keepsakes, no source, no clinical weight)
     ============================================================ */

  /* --- early days (0 to 4 months) --- */
  {key:'dl-cameHome', title:'First day home 🏡', type:'delight', domain:'firsts', cat:'Fun', mo:0, emoji:'🏡'},
  {key:'dl-firstbath', title:'First bath 🛁', type:'delight', domain:'firsts', cat:'Fun', mo:1, emoji:'🛁'},
  {key:'dl-firststroller', title:'First stroller ride', type:'delight', domain:'firsts', cat:'Fun', mo:1, emoji:'🚼'},
  {key:'dl-firstoutdoors', title:'First time outdoors 🌳', type:'delight', domain:'firsts', cat:'Fun', mo:1, emoji:'🌳'},
  {key:'dl-grippedfinger', title:'First time they gripped your finger', type:'delight', domain:'firsts', cat:'Social', mo:1, emoji:'🤏'},
  {key:'dl-eyecontact', title:'First long gaze into your eyes', type:'delight', domain:'firsts', cat:'Social', mo:1, emoji:'👀'},
  {key:'dl-firstgiggle', title:'First giggle', type:'delight', domain:'firsts', cat:'Fun', mo:3, emoji:'😄'},
  {key:'dl-foundfeet', title:'Discovered their own feet', type:'delight', domain:'firsts', cat:'Fun', mo:4, emoji:'🦶'},
  {key:'dl-firstbellylaugh', title:'First proper belly laugh', type:'delight', domain:'firsts', cat:'Fun', mo:4, emoji:'😂'},
  {key:'dl-firstsqueal', title:'First happy squeal', type:'delight', domain:'firsts', cat:'Fun', mo:4, emoji:'🎉'},

  /* --- food firsts --- */
  {key:'dl-firsttaste', title:'First taste of real food', type:'delight', domain:'firsts', cat:'Growth', mo:6, emoji:'😋'},
  {key:'dl-firstbanana', title:'First banana 🍌', type:'delight', domain:'firsts', cat:'Growth', mo:6, emoji:'🍌'},
  {key:'dl-firstavocado', title:'First avocado 🥑', type:'delight', domain:'firsts', cat:'Growth', mo:6, emoji:'🥑'},
  {key:'dl-firstsweetpotato', title:'First sweet potato', type:'delight', domain:'firsts', cat:'Growth', mo:6, emoji:'🍠'},
  {key:'dl-firstlemon', title:'First taste of lemon (and the face!) 🍋', type:'delight', domain:'firsts', cat:'Fun', mo:7, emoji:'🍋'},
  {key:'dl-firstberry', title:'First berries 🫐', type:'delight', domain:'firsts', cat:'Growth', mo:8, emoji:'🫐'},
  {key:'dl-firstmango', title:'First mango 🥭', type:'delight', domain:'firsts', cat:'Growth', mo:8, emoji:'🥭'},
  {key:'dl-firstwatermelon', title:'First watermelon 🍉', type:'delight', domain:'firsts', cat:'Growth', mo:9, emoji:'🍉'},
  {key:'dl-firstpasta', title:'First pasta 🍝', type:'delight', domain:'firsts', cat:'Growth', mo:10, emoji:'🍝'},
  {key:'dl-firsticecream', title:'First lick of ice cream 🍦', type:'delight', domain:'firsts', cat:'Fun', mo:14, emoji:'🍦'},
  {key:'dl-firstcake', title:'First taste of cake 🍰', type:'delight', domain:'firsts', cat:'Fun', mo:12, emoji:'🍰'},
  {key:'dl-firstfeedyou', title:'First time they fed you a bite', type:'delight', domain:'firsts', cat:'Social', mo:14, emoji:'🥄'},

  /* --- social and play firsts --- */
  {key:'dl-firstpeekaboo', title:'First peekaboo 🙈', type:'delight', domain:'firsts', cat:'Fun', mo:7, emoji:'🙈'},
  {key:'dl-firstfavtoy', title:'First favourite toy', type:'delight', domain:'firsts', cat:'Fun', mo:7, emoji:'🧸'},
  {key:'dl-firstfavbook', title:'First favourite book', type:'delight', domain:'firsts', cat:'Fun', mo:8, emoji:'📖'},
  {key:'dl-firsthug', title:'First real hug 🤗', type:'delight', domain:'firsts', cat:'Social', mo:9, emoji:'🤗'},
  {key:'dl-firstkissback', title:'First kiss back 😚', type:'delight', domain:'firsts', cat:'Social', mo:12, emoji:'😚'},
  {key:'dl-firstgames', title:'First game of chase', type:'delight', domain:'firsts', cat:'Fun', mo:13, emoji:'🏃'},
  {key:'dl-firstcuddletoy', title:'First time asking for their lovey', type:'delight', domain:'firsts', cat:'Social', mo:14, emoji:'🧸'},
  {key:'dl-firstjoke', title:'First time they made a joke', type:'delight', domain:'firsts', cat:'Fun', mo:24, emoji:'😜'},
  {key:'dl-firstpretend', title:'First pretend play', type:'delight', domain:'firsts', cat:'Fun', mo:18, emoji:'🎭'},
  {key:'dl-firsttantrum', title:'First big feelings moment', type:'delight', domain:'firsts', cat:'Social', mo:18, emoji:'🌧️'},
  {key:'dl-firstsorry', title:'First "sorry"', type:'delight', domain:'firsts', cat:'Social', mo:30, emoji:'💛'},
  {key:'dl-firstiloveyou', title:'First "I love you" 💗', type:'delight', domain:'firsts', cat:'Social', mo:24, emoji:'💗'},
  {key:'dl-firstwhy', title:'First "why?"', type:'delight', domain:'firsts', cat:'Fun', mo:30, emoji:'❓'},

  /* --- words firsts --- */
  {key:'dl-firstmama', title:'First "mama" 💕', type:'delight', domain:'firsts', cat:'Language', mo:10, emoji:'💕'},
  {key:'dl-firstdada', title:'First "dada" 💙', type:'delight', domain:'firsts', cat:'Language', mo:10, emoji:'💙'},
  {key:'dl-firstownname', title:'First time they said their own name', type:'delight', domain:'firsts', cat:'Language', mo:20, emoji:'🗣️'},
  {key:'dl-firstanimalsound', title:'First animal sound', type:'delight', domain:'firsts', cat:'Fun', mo:14, emoji:'🐮'},
  {key:'dl-firstsong', title:'First time they sang along 🎶', type:'delight', domain:'firsts', cat:'Fun', mo:20, emoji:'🎶'},
  {key:'dl-firstcounting', title:'First time counting out loud', type:'delight', domain:'firsts', cat:'Language', mo:30, emoji:'🔢'},

  /* --- movement and body firsts --- */
  {key:'dl-firstrollsurprise', title:'First surprise roll', type:'delight', domain:'firsts', cat:'Movement', mo:4, emoji:'🤸'},
  {key:'dl-firststeps', title:'First steps 👣', type:'delight', domain:'firsts', cat:'Movement', mo:12, emoji:'👣'},
  {key:'dl-firstrun', title:'First wobbly run', type:'delight', domain:'firsts', cat:'Movement', mo:18, emoji:'🏃'},
  {key:'dl-firstjump', title:'First jump', type:'delight', domain:'firsts', cat:'Movement', mo:24, emoji:'⬆️'},
  {key:'dl-firsttwirl', title:'First spin and twirl', type:'delight', domain:'firsts', cat:'Fun', mo:20, emoji:'💃'},
  {key:'dl-firstclimb', title:'First time climbing the sofa', type:'delight', domain:'firsts', cat:'Movement', mo:15, emoji:'🛋️'},
  {key:'dl-firsthaircut', title:'First haircut ✂️', type:'delight', domain:'firsts', cat:'Fun', mo:12, emoji:'✂️'},
  {key:'dl-firstshoes', title:'First shoes 👟', type:'delight', domain:'firsts', cat:'Fun', mo:12, emoji:'👟'},
  {key:'dl-firstwellies', title:'First puddle splash 🌧️', type:'delight', domain:'firsts', cat:'Fun', mo:16, emoji:'🌧️'},
  {key:'dl-firstscribble', title:'First scribble 🖍️', type:'delight', domain:'firsts', cat:'Fun', mo:15, emoji:'🖍️'},
  {key:'dl-firstpainting', title:'First finger painting 🎨', type:'delight', domain:'firsts', cat:'Fun', mo:18, emoji:'🎨'},
  {key:'dl-firstbubbles', title:'First time chasing bubbles', type:'delight', domain:'firsts', cat:'Fun', mo:12, emoji:'🫧'},
  {key:'dl-firstball', title:'First time kicking a ball ⚽', type:'delight', domain:'firsts', cat:'Movement', mo:18, emoji:'⚽'},
  {key:'dl-firstslide', title:'First time down the slide', type:'delight', domain:'firsts', cat:'Fun', mo:15, emoji:'🛝'},
  {key:'dl-firstswing', title:'First time on a swing', type:'delight', domain:'firsts', cat:'Fun', mo:12, emoji:'🌀'},
  {key:'dl-firsttricycle', title:'First tricycle 🚲', type:'delight', domain:'firsts', cat:'Movement', mo:30, emoji:'🚲'},
  {key:'dl-firstbalancebike', title:'First balance bike', type:'delight', domain:'firsts', cat:'Movement', mo:36, emoji:'🚲'},

  /* --- water and outdoors firsts --- */
  {key:'dl-firstswim', title:'First swim 🏊', type:'delight', domain:'firsts', cat:'Fun', mo:8, emoji:'🏊'},
  {key:'dl-firstsandcastle', title:'First sandcastle 🏖️', type:'delight', domain:'firsts', cat:'Fun', mo:14, emoji:'🏖️'},
  {key:'dl-firstgrass', title:'First time touching grass', type:'delight', domain:'firsts', cat:'Fun', mo:8, emoji:'🌱'},
  {key:'dl-firstpicnic', title:'First picnic in the park', type:'delight', domain:'firsts', cat:'Fun', mo:10, emoji:'🧺'},
  {key:'dl-firstrainbow', title:'First rainbow they spotted 🌈', type:'delight', domain:'firsts', cat:'Fun', mo:18, emoji:'🌈'},
  {key:'dl-firstmoon', title:'First time pointing at the moon 🌙', type:'delight', domain:'firsts', cat:'Fun', mo:14, emoji:'🌙'},
  {key:'dl-firstfeedingducks', title:'First time feeding the ducks', type:'delight', domain:'firsts', cat:'Fun', mo:14, emoji:'🦆'},
  {key:'dl-firstgardening', title:'First time helping in the garden', type:'delight', domain:'firsts', cat:'Fun', mo:24, emoji:'🌻'},

  /* --- sleep and home firsts --- */
  {key:'dl-firstowncot', title:'First night in their own cot', type:'delight', domain:'firsts', cat:'Sleep', mo:3, emoji:'🛏️'},
  {key:'dl-firstownroom', title:'First night in their own room', type:'delight', domain:'firsts', cat:'Sleep', mo:7, emoji:'🚪'},
  {key:'dl-firstbigbed', title:'First night in a big-kid bed', type:'delight', domain:'firsts', cat:'Sleep', mo:30, emoji:'🛌'},
  {key:'dl-firsthelped', title:'First time they tidied up', type:'delight', domain:'firsts', cat:'Self-care', mo:24, emoji:'🧹'},

  /* --- celebrations and milestones of the calendar --- */
  {key:'dl-firstbirthday', title:'First birthday 🎂', type:'delight', domain:'firsts', cat:'Fun', mo:12, emoji:'🎂'},
  {key:'dl-firstsecondbday', title:'Second birthday', type:'delight', domain:'firsts', cat:'Fun', mo:24, emoji:'🎂'},
  {key:'dl-firstthirdbday', title:'Third birthday', type:'delight', domain:'firsts', cat:'Fun', mo:36, emoji:'🎂'},
  {key:'dl-firstparty', title:'First birthday party 🎈', type:'delight', domain:'firsts', cat:'Fun', mo:12, emoji:'🎈'},
  {key:'dl-firstlosttooth', title:'First lost tooth 🦷', type:'delight', domain:'firsts', cat:'Teeth', mo:60, emoji:'🦷'},

  /* --- nursery and growing up firsts --- */
  {key:'dl-firstnursery', title:'First day at nursery', type:'delight', domain:'firsts', cat:'Social', mo:12, emoji:'🎒'},
  {key:'dl-firstpreschool', title:'First day of preschool', type:'delight', domain:'firsts', cat:'Social', mo:36, emoji:'🏫'},
  {key:'dl-firstpotty', title:'First time on the potty', type:'delight', domain:'firsts', cat:'Self-care', mo:24, emoji:'🚽'},
  {key:'dl-firstbigpants', title:'First day in big-kid pants', type:'delight', domain:'firsts', cat:'Self-care', mo:30, emoji:'🩲'},
  {key:'dl-firstdressself', title:'First time getting dressed alone', type:'delight', domain:'firsts', cat:'Self-care', mo:36, emoji:'👕'},
  {key:'dl-firstfriend', title:'First best friend', type:'delight', domain:'firsts', cat:'Social', mo:30, emoji:'👫'},

  /* ============================================================
     CONTEXT PACK: PET  (context:'pet'): the "[Baby] and [Pet]" thread
     ============================================================ */
  {key:'pet-firstmeet', title:'First time meeting the pet', type:'delight', domain:'firsts', cat:'Social', mo:0, context:'pet', emoji:'🐾'},
  {key:'pet-firstsniff', title:'First gentle sniff hello', type:'delight', domain:'firsts', cat:'Social', mo:1, context:'pet', emoji:'👃'},
  {key:'pet-firstgiggle', title:'First time the pet made baby giggle', type:'delight', domain:'firsts', cat:'Fun', mo:4, context:'pet', emoji:'😄'},
  {key:'pet-firstnap', title:'First nap together 😴', type:'delight', domain:'firsts', cat:'Sleep', mo:3, context:'pet', emoji:'😴'},
  {key:'pet-firstpat', title:'First gentle pat', type:'delight', domain:'firsts', cat:'Social', mo:7, context:'pet', emoji:'✋'},
  {key:'pet-firstreach', title:'First time reaching for the pet', type:'delight', domain:'firsts', cat:'Social', mo:6, context:'pet', emoji:'🤲'},
  {key:'pet-firstname', title:'First time saying the pet\'s name', type:'delight', domain:'firsts', cat:'Language', mo:14, context:'pet', emoji:'🗣️'},
  {key:'pet-firstfeed', title:'First time helping feed the pet', type:'delight', domain:'firsts', cat:'Self-care', mo:20, context:'pet', emoji:'🥣'},
  {key:'pet-firstwalk', title:'First walk together 🐕', type:'delight', domain:'firsts', cat:'Fun', mo:16, context:'pet', emoji:'🐕'},
  {key:'pet-firstadventure', title:'First shared adventure', type:'delight', domain:'firsts', cat:'Fun', mo:18, context:'pet', emoji:'🌟'},
  {key:'pet-firstcuddle', title:'First cuddle together', type:'delight', domain:'firsts', cat:'Social', mo:9, context:'pet', emoji:'🤗'},
  {key:'pet-firstchase', title:'First happy chase around the room', type:'delight', domain:'firsts', cat:'Fun', mo:15, context:'pet', emoji:'🏃'},

  /* ============================================================
     CONTEXT PACK: TRAVEL  (context:'travel')
     ============================================================ */
  {key:'tr-firstflight', title:'First flight ✈️', type:'delight', domain:'firsts', cat:'Fun', mo:6, context:'travel', emoji:'✈️'},
  {key:'tr-firstairport', title:'First time at the airport', type:'delight', domain:'firsts', cat:'Fun', mo:6, context:'travel', emoji:'🛫'},
  {key:'tr-firstroadtrip', title:'First road trip 🚗', type:'delight', domain:'firsts', cat:'Fun', mo:3, context:'travel', emoji:'🚗'},
  {key:'tr-firstholiday', title:'First holiday away', type:'delight', domain:'firsts', cat:'Fun', mo:8, context:'travel', emoji:'🧳'},
  {key:'tr-firstsea', title:'First time at the sea 🌊', type:'delight', domain:'firsts', cat:'Fun', mo:10, context:'travel', emoji:'🌊'},
  {key:'tr-firsttrain', title:'First train ride 🚂', type:'delight', domain:'firsts', cat:'Fun', mo:9, context:'travel', emoji:'🚂'},
  {key:'tr-firstmountains', title:'First time in the mountains', type:'delight', domain:'firsts', cat:'Fun', mo:12, context:'travel', emoji:'⛰️'},
  {key:'tr-firsthotel', title:'First night in a hotel', type:'delight', domain:'firsts', cat:'Sleep', mo:8, context:'travel', emoji:'🏨'},
  {key:'tr-firstboat', title:'First boat ride 🚤', type:'delight', domain:'firsts', cat:'Fun', mo:14, context:'travel', emoji:'🚤'},
  {key:'tr-firstpassport', title:'First passport stamp', type:'delight', domain:'firsts', cat:'Fun', mo:6, context:'travel', emoji:'🛂'},

  /* ============================================================
     CONTEXT PACK: PEOPLE  (context:'people')
     ============================================================ */
  {key:'pp-firstgrandparents', title:'First met grandparents 👵👴', type:'delight', domain:'firsts', cat:'Social', mo:0, context:'people', emoji:'👵'},
  {key:'pp-firstcousins', title:'First cousin meetup', type:'delight', domain:'firsts', cat:'Social', mo:2, context:'people', emoji:'👶'},
  {key:'pp-firstplaydate', title:'First playdate', type:'delight', domain:'firsts', cat:'Social', mo:8, context:'people', emoji:'🧒'},
  {key:'pp-firstbabysitter', title:'First time with a babysitter', type:'delight', domain:'firsts', cat:'Social', mo:6, context:'people', emoji:'💞'},
  {key:'pp-firstaunt', title:'First met auntie or uncle', type:'delight', domain:'firsts', cat:'Social', mo:1, context:'people', emoji:'🤍'},
  {key:'pp-firstsibling', title:'First met a big sibling', type:'delight', domain:'firsts', cat:'Social', mo:0, context:'people', emoji:'👧'},
  {key:'pp-firstfriendmeet', title:'First met your closest friends', type:'delight', domain:'firsts', cat:'Social', mo:1, context:'people', emoji:'🫶'},
  {key:'pp-firstgrouphug', title:'First family group photo', type:'delight', domain:'firsts', cat:'Fun', mo:1, context:'people', emoji:'📸'},

  /* ============================================================
     SEASONAL & CULTURAL FIRSTS
     region omitted = universal seasonal; region:['xx'] = cultural
     ============================================================ */
  {key:'se-firstsnow', title:'First snow ❄️', type:'delight', domain:'firsts', cat:'Fun', mo:10, emoji:'❄️'},
  {key:'se-firstautumn', title:'First crunchy autumn leaves 🍂', type:'delight', domain:'firsts', cat:'Fun', mo:8, emoji:'🍂'},
  {key:'se-firstspring', title:'First spring blossom 🌸', type:'delight', domain:'firsts', cat:'Fun', mo:6, emoji:'🌸'},
  {key:'se-firstrain', title:'First rainy day watching from the window', type:'delight', domain:'firsts', cat:'Fun', mo:4, emoji:'🌧️'},
  {key:'se-firstnewyear', title:'First New Year 🎆', type:'delight', domain:'firsts', cat:'Fun', mo:6, emoji:'🎆'},
  {key:'se-firstchristmas', title:'First Christmas 🎄', type:'delight', domain:'firsts', cat:'Fun', mo:6, emoji:'🎄'},
  {key:'se-firsthalloween', title:'First Halloween 🎃', type:'delight', domain:'firsts', cat:'Fun', mo:8, emoji:'🎃'},
  {key:'se-firstdiwali', title:'First Diwali 🪔', type:'delight', domain:'firsts', cat:'Fun', mo:6, region:['in'], emoji:'🪔'},
  {key:'se-firstholi', title:'First Holi 🎨', type:'delight', domain:'firsts', cat:'Fun', mo:8, region:['in'], emoji:'🎨'},
  {key:'se-firstrakhi', title:'First Raksha Bandhan', type:'delight', domain:'firsts', cat:'Social', mo:6, region:['in'], emoji:'🧵'},
  {key:'se-firsteid', title:'First Eid 🌙', type:'delight', domain:'firsts', cat:'Fun', mo:6, emoji:'🌙'},
  {key:'se-firstcny', title:'First Lunar New Year 🧧', type:'delight', domain:'firsts', cat:'Fun', mo:6, region:['cn'], emoji:'🧧'},
  {key:'se-firstthanksgiving', title:'First Thanksgiving 🦃', type:'delight', domain:'firsts', cat:'Fun', mo:6, region:['us'], emoji:'🦃'},
  {key:'se-firstannaprasana', title:'First grain ceremony', type:'delight', domain:'firsts', cat:'Growth', mo:6, region:['in'], emoji:'🍚'},
  {key:'se-firstcakesmash', title:'First cake smash 🎂', type:'delight', domain:'firsts', cat:'Fun', mo:12, emoji:'🎂'}

];

window.MILESTONE_CONTEXTS = [
  {id:'pet', label:'Do you have a pet?', ask:'pet name + type'},
  {id:'travel', label:'Do you travel together?', ask:'opt in to first-flight, road-trip and seaside firsts'},
  {id:'people', label:'Who is in your circle?', ask:'grandparents, cousins, playdates and babysitter firsts'}
];
