/* Cubby — the teaching registry.
   ------------------------------------------------------------------------------------------------
   One row per capability. Every teaching surface renders from here, and the marketing FAQ section
   generates from here, because content written twice is content that drifts — and drifted teaching
   copy is worse than none: it tells a parent something the app no longer does.

   DEPTH IS A PROPERTY OF THE ROW, not a separate tier list.
     every row      -> `one`, the one-line answer. Feeds the info dot, the answer search, the FAQ.
     + what/get     -> earns a guide chapter.
     + earn         -> may compete for the day's allowance. NO `earn` MEANS IT CAN NEVER PUSH,
                       which is a structural guarantee rather than a matter of discipline.

   `who` narrows who is ever offered a row. It may only narrow, never widen: a row can be stricter
   than the shell but must never claim a surface the shell would not open for that person. Mood is
   owner-only and must stay owner-only in the ANSWER SEARCH too — gating the dot while leaving the
   row findable would leak the existence of a private record to a caregiver.

   NO_TEACH is not a leftovers bin. It is the other half of the coverage gate: every entry point in
   the app is in one of these two objects, each exclusion carrying its reason in writing. The count
   was wrong twice before it was right (a shell-only grep misses the modules; four entry points are
   `window.X = function` assignments no `function open*` pattern catches), which is the whole
   argument for the gate existing.

   Generated once from the reconciled 148-entry classification, then maintained by hand.
*/
(function () {
  'use strict';

  var TEACH = {
    /* ---- Everyday logging (23) ---- */
    openFeed: { label: 'Feed', fn: 'openFeed()', domain: 'log', depth: 'page',
      one: 'Breast, bottle, water or solids, with a live timer for nursing.',
      who: { stage: ['baby','child'] },
      why: 'When was the last one is the question that starts every handover and every night waking, and it is the one thing nobody holds accurately in their head at four in the morning.',
      matters: [
        ['When it happened, not when you logged it', 'Every sheet lets you move the time. The moment you have a free hand is rarely the moment it happened, and an app that insists otherwise just gets fed wrong times.'],
        ['Which side, or how much', 'Whichever your day is actually measured in. Cubby does not convert one into the other, and it will never suggest a number you ought to be reaching.'],
        ['The timer runs on every phone', 'Start a nursing timer and everyone in your circle sees it running, so nobody restarts a feed that is already underway.'],
        ['A quiet day is a day too', 'Nothing is scored, nothing is compared to another baby, and a gap in the record is not a mark against anyone.']
      ],
      how: [
        'One tap from your home row. Breast, bottle, water or solids.',
        'Start a timer, or write it up afterwards. Both end in the same place.',
        'Change the time on anything, at any point, including days later.',
        'The last feed sits at the top of your home screen, so nobody goes looking.'
      ],
      payoff: 'Nobody has to ask, guess, or wake someone up to find out when she last fed.',
      read: 'how-often-to-feed-newborn'
    },
    openSleep: { label: 'Sleep', fn: 'openSleep()', domain: 'log', depth: 'page',
      one: 'Start a nap with one tap. The timer shows on every phone in your circle.',
      who: { stage: ['baby','child'] },
      earn: { on: 'first-log' },
      why: 'Sleep is the thing everyone has an opinion about and nobody has a record of. A timer running on every phone in the circle turns a nightly disagreement into a shared fact.',
      matters: [
        ['One tap down, one tap up', 'The moment a baby finally goes down is not the moment to be filling in a form.'],
        ['Everyone can see it running', 'Nobody opens the door of a dark room to check whether she is still asleep. That on its own earns the log.'],
        ['A nap that started a while ago', 'If they drifted off half an hour before you got to your phone, say so. Nothing has to be caught live.'],
        ['Wakings belong to the nap', 'A night broken three times is not the same night as an unbroken one, and a single total would hide exactly that.']
      ],
      how: [
        'Tap Sleep to start it. Tap again when they wake.',
        'Set an earlier start if it began before you reached your phone.',
        'Add the disturbances, so the total is the sleep they actually got.',
        'A finished nap can be written up from scratch afterwards.'
      ],
      payoff: 'The day\'s sleep becomes something you can look at, instead of something you are arguing about.',
      read: 'newborn-sleep-what-is-normal'
    },
    /* label MUST match the sheet's own <h2> exactly, because CubbyTeachUI.sheetDot finds the sheet
       by comparing that heading against these labels. Renaming the heading to "Nappy" without this
       silently removed the info dot from the sheet: sheetDot returns the html untouched when it
       cannot match, so help disappears with no error anywhere. tools/info_dot_check.js now fails
       on that drift instead of letting it go quiet. */
    /* aka, because the sheet heading is a question rather than a noun and sheetDot matches on the
       heading. Reached from the nudge that appears when a nap timer has run over twelve hours. */
    openSleepCorrect: { label: 'Fix a forgotten timer', aka: ['when did this nap end'],
      fn: 'openSleepCorrect()', domain: 'log', depth: 'one',
      one: 'If a nap timer ran all night because Stop never got tapped, say when they actually woke and Cubby logs the real nap.',
      who: { stage: ['baby', 'child'] } },
    openDiaper: { label: 'Nappy', aka: ['diaper'], fn: 'openDiaper()', domain: 'log', depth: 'page',
      one: 'Wet, dirty, both, or a dry check. The thing a doctor almost always asks about.',
      who: { stage: ['baby','child'] },
      why: 'It is the question a doctor almost always asks, and the one nobody can answer under pressure. Nappies are also the log with the shortest memory: by the evening, the morning has gone.',
      matters: [
        ['Wet and dirty, kept apart', 'They answer different questions, so one combined number answers neither. Cubby keeps them separate and never tells you what a count means. That is the conversation you have with your doctor, and this is what you bring to it.'],
        ['The time, not only the count', '"Six today" and "six today, the last one at four in the morning" are different facts, and only one of them is useful in a waiting room.'],
        ['A dry check counts', 'The entry that says you looked and there was nothing is real information. It is also the one that goes missing everywhere else, which turns a gap in the record into a guess.'],
        ['Anything that made you look twice', 'In your own words. Cubby does not interpret it and will never grade it. The person you show it to can.']
      ],
      how: [
        'One tap from your home row. Wet, dirty, both, or a dry check.',
        'Change the time if it happened earlier. Nothing has to be logged the moment it happens.',
        'Anyone in your circle can log one, and it appears on every phone straight away.',
        'The day\'s count sits on your home screen, so nobody is adding up in their head.'
      ],
      payoff: 'When someone asks how many wet nappies today and when the last dirty one was, you read the answer instead of reconstructing it.',
      read: 'bathing-washing-and-nappy-care' },
    openPump: { label: 'Pump', fn: 'openPump()', domain: 'log', depth: 'page',
      one: 'How much you expressed, which side, and when.',
      who: { stage: ['baby','child'] },
      why: 'Expressing is work that disappears from the day the moment it is done, and the stash is what decides whether anybody else can take a feed tonight.',
      matters: [
        ['How much, and which side', 'A week of sessions shows a pattern. The last session on its own shows almost nothing.'],
        ['The time it happened', 'Pumping is rhythm-sensitive in a way most logs are not, and a session without a time cannot show a rhythm.'],
        ['Your stash lives in one place', 'Rather than on the back of a receipt, or in a note you will not find again at midnight.'],
        ['There is no target here', 'Cubby holds no expectation of you and will never suggest one. It shows your own days back to you and stops there.']
      ],
      how: [
        'Log the amount, the side, and the time, in whichever units you already think in.',
        'Move the time afterwards if you were busy at the point it happened.',
        'It sits alongside feeds, so the day reads as one story rather than two.',
        'Anyone in your circle can see the stash without asking you for a number.'
      ],
      payoff: 'The person doing the night feed knows what is there, and you did not have to tell them.'
    },
    openActivity: { label: 'Add to the day', fn: 'openActivity()', domain: 'log', depth: 'chapter',
      one: 'Tummy time, a bath, a walk, or a line about the day. Add a photo if you took one.',
      who: { stage: ['baby','child'] },
      what: 'Tummy time, a bath, a walk, or just a line about the day. Add a photo if you took one.',
      get: 'The photo lands in your album, ready to become something you keep.'
    },
    openGrowth: { label: 'Measurement', fn: 'openGrowth()', domain: 'log', depth: 'page',
      one: 'Weight and height whenever you have them. One of the two is fine.',
      who: { stage: ['baby','child'] },
      earn: { on: 'growth-2-points' },
      why: 'One measurement is a dot. Several over a few months are a line, and the line is the thing a doctor can actually read. It is worth logging the ones you already get at appointments.',
      matters: [
        ['One of the two is enough', 'Weight or height. A visit that only produced one number is still worth writing down, and half a record beats none.'],
        ['The date carries the meaning', 'A weight without a date cannot join a curve, and joining the curve is the entire point of keeping it.'],
        ['The curve is a guide, never a verdict', 'Cubby draws where the numbers sit against the published charts. It does not interpret them, flag them, or tell you what they mean.'],
        ['Bring it, do not act on it', 'The chart exists so a conversation with your doctor starts from a record instead of a memory.']
      ],
      how: [
        'Add a weight or a height whenever you have one, usually straight after a visit.',
        'Pick your units once. Cubby keeps using the ones you think in.',
        'Two or more measurements start drawing the line.',
        'It goes into the visit summary automatically, so you do not gather it twice.'
      ],
      payoff: 'You arrive at the next appointment with the history already drawn, instead of a number on a scrap of paper.'
    },
    openMilestone: { label: 'Milestone', fn: 'openMilestone()', domain: 'log', depth: 'page',
      one: 'The firsts, from a library of ideas or in your own words.',
      who: { stage: ['baby','child'] },
      earn: { on: 'month-1' },
      why: 'The firsts are the part you will want to read back in a year, and they are also the part that vanishes fastest, because at the time it just feels like a Tuesday.',
      matters: [
        ['Your words beat a checklist', 'There is a library of ideas if you want a prompt, but the ones written in your own words are the ones worth rereading.'],
        ['There is no pass and no fail', 'Every baby arrives at their own time. Cubby does not compare yours to an average and will not tell you anyone is behind.'],
        ['The date can be approximate', 'Set it to the day you remember. A first noticed three days late is still a first.'],
        ['A photo makes it a keepsake', 'Add one and the moment turns into something you can put in an album later, rather than a line of text.']
      ],
      how: [
        'Pick from the library, or write your own in a sentence.',
        'Set the day it happened, not the day you got round to it.',
        'Add a photo if you took one.',
        'Everyone in your circle sees it, so grandparents hear about it without a phone call.'
      ],
      payoff: 'A year from now there is something to read back that is more than dates and numbers.'
    },
    openCustomMilestone: { label: 'New moment', fn: 'openCustomMilestone()', domain: 'log', depth: 'one',
      one: 'A first that is not on anybody\'s list but yours.',
      who: { stage: ['baby','child'] } },
    openQuickLog: { label: 'Quick log', fn: 'openQuickLog()', domain: 'log', depth: 'chapter',
      one: 'The one-tap row on your home screen. You choose which four sit there.',
      who: { stage: ['baby','child'] },
      earn: { on: 'logs-10' },
      what: 'The four buttons on your home screen, and which four they are is your choice.',
      get: 'The things you do ten times a day sit one tap away, and your partner can choose a different four.'
    },
    openFirstLog: { label: 'Your first log', fn: 'openFirstLog()', domain: 'log', depth: 'one',
      one: 'The very first entry, opened straight from the empty home screen.',
      who: { stage: ['baby','child'] } },
    openMoreLogs: { label: 'More logs', fn: 'openMoreLogs()', domain: 'log', depth: 'one',
      one: 'The early-days logs, whenever you need them: feed, nappy, pump.',
      who: { stage: ['baby','child'] },
      earn: { on: 'logs-5' } },
    openAddEntry: { label: 'Add to Cubby', fn: 'openAddEntry()', domain: 'log', depth: 'one',
      one: 'Every log in one list, when the quick row does not have what you want.',
      who: { stage: ['baby','child'] },
      earn: { on: 'logs-25' } },
    openPastFeed: { label: 'Past feed', fn: 'openPastFeed()', domain: 'log', depth: 'one',
      one: 'A feed that already happened. Late is fine, nothing has to be logged live.',
      who: { stage: ['baby','child'] },
      earn: { on: 'logs-10' } },
    openPastSleep: { label: 'Finished nap', fn: 'openPastSleep()', domain: 'log', depth: 'one',
      one: 'A nap that ended before you got to your phone.',
      who: { stage: ['baby','child'] } },
    openSleepOngoing: { label: 'Already napping', fn: 'openSleepOngoing()', domain: 'log', depth: 'one',
      one: 'They drifted off a while ago. Set when it actually started.',
      who: { stage: ['baby','child'] },
      earn: { on: 'sleep-logged-3' } },
    openEdit: { label: 'Fix an entry', fn: 'openEdit()', domain: 'log', depth: 'page',
      one: 'Wrong day, wrong time, a nap\'s wake time. Mistakes are meant to be fixable.',
      who: { stage: ['baby','child'] },
      earn: { on: 'first-log' },
      why: 'Every log in this app can be corrected, and knowing that up front changes how you use it. An app you cannot fix is one you start hesitating to write in.',
      matters: [
        ['Wrong time is the usual mistake', 'Logged at bedtime for something that happened at lunch. Move it, and the day reads correctly again.'],
        ['A nap that ran on', 'Wake times get missed. Set the real end and every total that used it updates with it.'],
        ['Your own entries, always', 'Anyone in the circle can fix what they logged. Nothing is frozen because somebody was in a hurry.'],
        ['Deleted is not gone', 'Removed entries wait in Recently deleted, so a wrong tap at 3am is not permanent.']
      ],
      how: [
        'Tap any entry in the log to open it.',
        'Change the time, the day, the amount, or the note.',
        'Delete it if it should not be there, and recover it from Recently deleted if it should.',
        'Everyone in the circle sees the corrected version straight away.'
      ],
      payoff: 'You can log fast and messily, which is the only way anyone logs at four in the morning.'
    },
    openTrash: { label: 'Recently deleted', fn: 'openTrash()', domain: 'log', depth: 'one',
      one: 'Deleted entries wait here before they go for good.',
      who: { stage: ['baby','child'] },
      earn: { on: 'first-delete' } },
    openDayLog: { label: 'The whole day', fn: 'openDayLog()', domain: 'log', depth: 'one',
      one: 'Everything logged on one day, in order.',
      who: { stage: ['baby','child'] },
      earn: { on: 'logs-25' } },
    openDayRecap: { label: 'Day recap', fn: 'openDayRecap()', domain: 'log', depth: 'one',
      one: 'How the day went, gathered into one read.',
      who: { stage: ['baby','child'] },
      earn: { on: '7-days-logged' } },
    openRoutinesEdit: { label: 'Rituals', fn: 'openRoutinesEdit()', domain: 'log', depth: 'page',
      one: 'The rhythm you are building. A gentle \'four of seven\', never a streak.',
      who: { stage: ['baby','child'] },
      earn: { on: '7-days-logged' },
      why: 'A ritual is the thing you are trying to make ordinary. Seeing it happen four days out of seven is encouraging in a way a perfect run of seven never actually is.',
      matters: [
        ['Four of seven is a good week', 'Cubby counts days, not streaks. Nothing resets to zero because of one hard night, because that is not how a real week goes.'],
        ['You choose what counts', 'Bath, story, walk, tummy time. These are your rituals, not a template somebody else decided was correct.'],
        ['It is a mirror, not a target', 'There is no goal to hit and no notification if a day passes without one.'],
        ['Everyone contributes', 'A ritual kept by whoever was on duty is still kept. The rhythm belongs to the household.']
      ],
      how: [
        'Add the few things you want to become ordinary.',
        'Tick them off on the days they happen.',
        'The card shows how this week has gone, gently.',
        'Change or remove any of them whenever the season of life changes.'
      ],
      payoff: 'You can see the shape you are building, without being punished on the days it does not happen.'
    },
    openRoutineItem: { label: 'A ritual', fn: 'openRoutineItem()', domain: 'log', depth: 'one',
      one: 'One ritual, and how this week has gone for it.',
      who: { stage: ['baby','child'] } },
    openActivityPhoto: { label: 'Photo on an activity', fn: 'openActivityPhoto()', domain: 'log', depth: 'one',
      one: 'The photo lands in your album, tagged with the day it belongs to.',
      who: { stage: ['baby','child'] },
      earn: { on: 'first-photo' } },
    openVoiceLog: { label: 'Say it', fn: 'openVoiceLog()', domain: 'log', depth: 'chapter',
      one: 'Speak a feed, a nap or a nappy and Cubby writes it down. You confirm before it saves.',
      who: { stage: ['baby','child'] },
      earn: { on: 'logs-25' },
      what: 'Say a feed, a nap, a nappy or a pump out loud and Cubby writes it down. You always confirm before anything is saved.',
      get: 'For the times you have one hand free and it is not the one holding the phone.'
    },

    /* ---- Health and guidance (19) ---- */
    openTemp: { label: 'Temperature', fn: 'openTemp()', domain: 'health', depth: 'page',
      one: 'A reading, with plain guidance beside it. Cubby never diagnoses.',
      who: { stage: ['baby','child'] },
      earn: { on: 'month-2' },
      why: 'A temperature on its own answers almost nothing. The same reading means one thing at nine in the morning and something else as the third in a row, and that sequence is what you will be asked for.',
      matters: [
        ['The time matters as much as the number', 'A direction is what a clinician reads. A single figure with no time cannot show one.'],
        ['Cubby does not decide what is high', 'It records and orders. Guidance beside a reading comes from published sources and is never Cubby telling you what is happening to your child.'],
        ['Where you took it', 'Under the arm and in the ear are not interchangeable, and the person you speak to will want to know which.'],
        ['It gathers itself into the illness', 'If an illness is running, every reading joins its timeline without you filing anything.']
      ],
      how: [
        'Log the reading and the time. Change the time if you took it earlier.',
        'Keep using whichever unit you already think in.',
        'Anyone in your circle can add one, so the night shift is in the same record.',
        'It flows into the visit summary on its own.'
      ],
      payoff: 'When someone asks how long and how high, you read out a sequence instead of trying to reconstruct three days.'
    },
    openSymptom: { label: 'Symptom', fn: 'openSymptom()', domain: 'health', depth: 'chapter',
      one: 'How they are, in your words or from a list.',
      who: { stage: ['baby','child'] },
      earn: { on: 'temp-logged' },
      what: 'How they are, in your own words or from a list.',
      get: 'Three weeks of small things is impossible to recall at once, and this is what you read from instead.'
    },
    openStartIllness: { label: 'Feeling poorly?', fn: 'openStartIllness()', domain: 'health', depth: 'page',
      one: 'Start tracking an illness, so the timeline is ready for the call.',
      who: { stage: ['baby','child'] },
      earn: { on: 'temp-logged' },
      why: 'An illness is not a moment, it is a shape over several days. The question at the appointment is almost never how they are right now. It is when this started and what it has done since, and that is the part memory loses first.',
      matters: [
        ['When it started', 'The first thing you will be asked and the first thing that blurs. Day three of a fever and day one look identical from the inside.'],
        ['Every temperature with its time', 'A number on its own cannot show a direction. The same reading means something different at nine in the morning than it does at three in a row.'],
        ['What you gave, and when', 'So two people cannot double a dose, and so whoever you speak to knows what has already been tried before they suggest it.'],
        ['What changed, including nothing', 'Better, worse, or the same. Three days of the same is not an empty record. It is the finding.']
      ],
      how: [
        'Start an illness when it begins. Cubby gathers everything logged while it is running.',
        'Temperatures, medicines, symptoms and notes attach themselves to it by time. You do not file anything.',
        'Everyone in your circle adds to the same timeline, so the night shift is in it too.',
        'End it when they are well. It stays in the record as a closed chapter you can look back at.'
      ],
      payoff: 'You arrive with a timeline instead of a memory, on the day you have slept the least. Cubby never says whether a temperature is high, and never suggests what any of it means.' },
    openCondition: { label: 'A condition', fn: 'openCondition()', domain: 'health', depth: 'one',
      one: 'Something ongoing, kept where the rest of the health record is.',
      who: { stage: ['baby','child'] } },
    openManageConditions: { label: 'Health trackers', fn: 'openManageConditions()', domain: 'health', depth: 'one',
      one: 'Turn on only the trackers that apply to you.',
      who: { stage: ['baby','child'] } },
    openAddMed: { label: 'Add medicine', fn: 'openAddMed()', domain: 'health', depth: 'chapter',
      one: 'What you gave, how much, and when. Two people cannot double a written-down dose.',
      who: { stage: ['baby','child'] },
      earn: { on: 'illness-started' },
      what: 'What you gave, how much, and when.',
      get: 'Two people caring for one baby cannot double a dose if the last one is written down.'
    },
    openMedSheet: { label: 'A medicine', fn: 'openMedSheet()', domain: 'health', depth: 'page',
      one: 'The dose, the schedule, and when the last one was given, by whom.',
      who: { stage: ['baby','child'] },
      earn: { on: 'med-added' },
      why: 'Two adults caring for one child cannot double a dose that is written down, and cannot miss one either. This is the log where the cost of a gap is highest and the effort of keeping it is lowest.',
      matters: [
        ['The last dose, and who gave it', 'The row says both. That single line is what stops the 2am conversation about whether it has already been done.'],
        ['Cubby warns before it writes', 'Tap Dose again too soon and it tells you when the last one was, before anything is recorded.'],
        ['The schedule, not the arithmetic', 'Add how often or at what times once. Nothing has to be worked out again while holding a crying child.'],
        ['The course ends when it ends', 'Set times can go into your own calendar and stop on their own, so no reminder outlives the prescription.']
      ],
      how: [
        'Add the medicine once, with the dose and how often it is given.',
        'Tap Dose each time. It records the time, the amount and the person.',
        'Everyone in the circle sees the same last dose, straight away.',
        'Put the set times into your calendar if the alarm is easier coming from your own phone.'
      ],
      payoff: 'Nobody doubles a dose, nobody misses one, and nobody has to text somebody else to be sure.'
    },
    openMedManage: { label: 'Manage medicines', fn: 'openMedManage()', domain: 'health', depth: 'one',
      one: 'Everything currently prescribed, in one place.',
      who: { stage: ['baby','child'] } },
    openDoseCalendar: { label: 'Doses in your calendar', fn: 'openDoseCalendar()', domain: 'health', depth: 'chapter',
      one: 'Set times go into your own calendar, so the alarm comes from something you already trust.',
      who: { stage: ['baby','child'] },
      earn: { on: 'med-added' },
      what: 'The set times for a course, written into the calendar you already use.',
      get: 'The reminder arrives from something you already trust, and it ends when the course does.'
    },
    openVaccine: { label: 'A vaccine', fn: 'openVaccine()', domain: 'health', depth: 'chapter',
      one: 'One vaccine, when it is due, and whether it has been given.',
      who: { stage: ['baby','child'] },
      earn: { on: 'birthday-set' },
      what: 'One vaccine: when it is due, whether it has been given, and on what date.',
      get: 'The answer to what has she had, and when, is on your phone rather than in a folder at home.'
    },
    openVaccineCountry: { label: 'Vaccine schedule', fn: 'openVaccineCountry()', domain: 'health', depth: 'page',
      one: 'The schedule for where you are, filled in the day you gave a birthday.',
      who: { stage: ['baby','child'] },
      earn: { on: 'birthday-set' },
      why: 'The schedule was filled in the day you gave a birthday. It is already sitting there, which is worth knowing, because most people find it by accident months later.',
      matters: [
        ['It follows where you are', 'Schedules differ by country. Cubby uses the one for your region rather than a single global list that would be wrong for most people.'],
        ['Ticking off is the whole job', 'Mark each one as it is given. There is nothing else to maintain.'],
        ['A date you are unsure of', 'An estimated date is marked as estimated rather than quietly presented as fact. You can set the real one whenever you have it.'],
        ['It is a record, not advice', 'Cubby will not recommend, schedule or advise on any vaccination. It shows the published plan and tracks what has happened.']
      ],
      how: [
        'Set a birthday and the plan appears, already filled in.',
        'Tick each one off as it happens, adding the date.',
        'Add anything your schedule does not include.',
        'It goes with you into the visit summary and the doctor report.'
      ],
      payoff: 'The answer to what has she had, and when is on your phone rather than in a folder at home.'
    },
    openAddVaccine: { label: 'Add a vaccine', fn: 'openAddVaccine()', domain: 'health', depth: 'one',
      one: 'Something your schedule does not include.',
      who: { stage: ['baby','child'] } },
    openVisitSummary: { label: 'Visit summary', fn: 'openVisitSummary()', domain: 'health', depth: 'page',
      one: 'The things a doctor usually asks, gathered into one page you can read out.',
      who: { stage: ['baby','child'] },
      earn: { on: 'fever' },
      why: 'The appointment is ten minutes long and you are holding a baby who is not having a good day. This is the page that means you are not answering from memory while trying to keep them calm.',
      matters: [
        ['It is already written', 'Built from what you have logged. There is no form to fill in beforehand, which matters because the days you need it are the days you have least to give.'],
        ['The dates and the times are in it', 'Because a few days ago is not an answer, and under pressure it is the only one most of us can give.'],
        ['Your words stay yours', 'What you noticed is kept beside the numbers, not blended into them. Nobody has to take your account on trust and nobody has to dig for it.'],
        ['It is a record, never an opinion', 'Cubby gathers, orders and hands over. It does not assess, score or diagnose, and it will not imply anything about what the numbers mean.']
      ],
      how: [
        'Open it before you go. It gathers the last fortnight, or the illness if one is running.',
        'Feeds, nappies, sleep, temperatures, medicines and your notes, in time order.',
        'Read it out, hand the phone over, or print it.',
        'Nothing leaves your phone unless you choose to send it.'
      ],
      payoff: 'The ten minutes get spent on what to do next, instead of on rebuilding what already happened.' },
    openDoctorReport: { label: 'Last 14 days', fn: 'openDoctorReport()', domain: 'health', depth: 'page',
      one: 'A fortnight of the record, ready to hand over.',
      who: { stage: ['baby','child'] },
      earn: { on: 'appt-added' },
      why: 'A fortnight of the record on one page, ready to hand over. It exists for the appointments where the useful question is what has been happening rather than what is happening now.',
      matters: [
        ['It is built, not filled in', 'Everything in it is already logged. There is no form to complete the night before.'],
        ['Fourteen days, in order', 'Long enough to show a pattern, short enough to be read in a waiting room.'],
        ['Numbers and your words, kept apart', 'What you noticed sits beside the figures rather than blended into them, so neither has to be dug out of the other.'],
        ['Nothing is interpreted', 'Cubby gathers and orders. It draws no conclusion and offers no opinion about any of it.']
      ],
      how: [
        'Open it before the appointment.',
        'Read it out, hand the phone over, or print it.',
        'It stays on your phone unless you choose to send it.',
        'Everything in it came from what you and your circle already logged.'
      ],
      payoff: 'The conversation starts from a record, which usually means it starts further along.'
    },
    openVisit: { label: 'Log a visit', fn: 'openVisit()', domain: 'health', depth: 'one',
      one: 'What was said, while you still remember it.',
      who: { stage: ['baby','child'] },
      earn: { on: 'appt-added' } },
    openDoctor: { label: 'Your doctor', fn: 'openDoctor()', domain: 'health', depth: 'one',
      one: 'Who you see, and how to reach them.',
      who: { stage: ['baby','child'] },
      earn: { on: 'illness-started' } },
    openDoctorEdit: { label: 'Edit doctor', fn: 'openDoctorEdit()', domain: 'health', depth: 'one',
      one: 'Keep the details current.',
      who: { stage: ['baby','child'] } },
    openFoodPrefs: { label: 'Food and allergies', fn: 'openFoodPrefs()', domain: 'health', depth: 'one',
      one: 'What they eat, what they react to, what to avoid.',
      who: { stage: ['baby','child'] },
      earn: { on: 'month-5' } },
    openReadingRoom: { label: 'Good reads', fn: 'openReadingRoom()', domain: 'health', depth: 'chapter',
      one: 'Short reads that match the stage you are in. Written and sourced, never generated.',
      who: { stage: ['baby','child'] },
      earn: { on: 'week-1' },
      what: 'Short reads chosen for the stage you are in, written and sourced rather than generated.',
      get: 'Something to read at 3am that is not a search result written by nobody in particular.'
    },

    /* ---- Pregnancy (29) ---- */
    openStartPregnancy: { label: 'Start a pregnancy', fn: 'openStartPregnancy()', domain: 'preg', depth: 'chapter',
      one: 'Tell Cubby you are expecting, and everything reshapes around it.',
      who: { stage: ['pregnancy'] },
      what: 'Tell Cubby you are expecting, and give a due date.',
      get: 'The home screen, the logs and the tools reshape around the pregnancy, and none of it counts down at you.'
    },
    openExpectingSetup: { label: 'Expecting setup', fn: 'openExpectingSetup()', domain: 'preg', depth: 'one',
      one: 'Due date, and how you would like the weeks counted.',
      who: { stage: ['pregnancy'] } },
    openEditPregnancy: { label: 'Due date and schedule', fn: 'openEditPregnancy()', domain: 'preg', depth: 'one',
      one: 'Change the date, change the schedule. Nothing is locked in.',
      who: { stage: ['pregnancy'] } },
    openWeekDetail: { label: 'This week', fn: 'openWeekDetail()', domain: 'preg', depth: 'chapter',
      one: 'What is happening this week, without a countdown.',
      who: { stage: ['pregnancy'] },
      earn: { on: 'pregnancy-started' },
      what: 'What is happening this week, in plain words.',
      get: 'Context without a countdown, because a number of days remaining is not a comfort to everyone.'
    },
    openKickCounter: { label: 'Kick counter', fn: 'openKickCounter()', domain: 'preg', depth: 'chapter',
      one: 'Count the movements in one sitting. You learn what usual looks like for your baby.',
      who: { stage: ['pregnancy'] },
      earn: { on: 'week-28' },
      what: 'Count the movements you feel in one sitting.',
      get: 'You learn what usual looks like for your baby, which is the thing that makes a change worth mentioning.'
    },
    openContractions: { label: 'Contraction timer', fn: 'openContractions()', domain: 'preg', depth: 'chapter',
      one: 'How long, and how far apart, so you are not guessing on the phone.',
      who: { stage: ['pregnancy'] },
      earn: { on: 'week-36' },
      what: 'Time them, from the first twinge to the end of each one.',
      get: 'When you call, you can say how long and how far apart instead of guessing.'
    },
    openLogSymptom: { label: 'Log a symptom', fn: 'openLogSymptom()', domain: 'preg', depth: 'chapter',
      one: 'How you are feeling, so appointments are not done from memory.',
      who: { stage: ['pregnancy'] },
      earn: { on: 'week-6' },
      what: 'How you are feeling, in your own words or from a list.',
      get: 'Appointments go better when you are not trying to remember three weeks at once.'
    },
    openLogWeight: { label: 'Your weight', fn: 'openLogWeight()', domain: 'preg', depth: 'one',
      one: 'Yours, not the baby\'s. Kept private to you.',
      who: { stage: ['pregnancy'] },
      earn: { on: 'week-10' } },
    openLogBP: { label: 'Blood pressure', fn: 'openLogBP()', domain: 'preg', depth: 'one',
      one: 'A reading, with the numbers your midwife will want.',
      who: { stage: ['pregnancy'] },
      earn: { on: 'week-20' } },
    openBPWatch: { label: 'Blood pressure watch', fn: 'openBPWatch()', domain: 'preg', depth: 'one',
      one: 'When someone has asked you to keep an eye on it.',
      who: { stage: ['pregnancy'] } },
    openGlucoseLog: { label: 'Blood glucose', fn: 'openGlucoseLog()', domain: 'preg', depth: 'one',
      one: 'A reading, in the units you were given.',
      who: { stage: ['pregnancy'] } },
    openGlucoseTracker: { label: 'Gestational diabetes', fn: 'openGlucoseTracker()', domain: 'preg', depth: 'chapter',
      one: 'The readings, the targets you were given, and the pattern between them.',
      who: { stage: ['pregnancy'] },
      earn: { on: 'condition-added' },
      what: 'Your readings, kept beside the targets your own clinician gave you.',
      get: 'The pattern is visible without arithmetic, and the targets stay the ones you were actually given rather than any Cubby invented.'
    },
    openUrineLog: { label: 'Urine protein', fn: 'openUrineLog()', domain: 'preg', depth: 'one',
      one: 'What the dipstick said, kept with the rest.',
      who: { stage: ['pregnancy'] } },
    openNausea: { label: 'Nausea and hydration', fn: 'openNausea()', domain: 'preg', depth: 'one',
      one: 'How rough it has been, and whether you are keeping fluids down.',
      who: { stage: ['pregnancy'] },
      earn: { on: 'week-6' } },
    openSupplements: { label: 'Supplements and meds', fn: 'openSupplements()', domain: 'preg', depth: 'one',
      one: 'What you are taking while expecting.',
      who: { stage: ['pregnancy'] },
      earn: { on: 'week-4' } },
    openAntenatalFacts: { label: 'Your antenatal record', fn: 'openAntenatalFacts()', domain: 'preg', depth: 'chapter',
      one: 'Blood group, screening, scans. The flowsheet a midwife recognises.',
      who: { stage: ['pregnancy'] },
      earn: { on: 'appt-added' },
      what: 'Blood group, screening results and scan findings, in the order a midwife reads them.',
      get: 'The flowsheet you would otherwise be carrying on paper, in the folder you left at home.'
    },
    openAddAppt: { label: 'Add appointment', fn: 'openAddAppt()', domain: 'preg', depth: 'chapter',
      one: 'Scans and checks, with the reminder in your own calendar.',
      who: { stage: ['pregnancy'] },
      earn: { on: 'pregnancy-started' },
      what: 'Scans and checks, with the date and where it is.',
      get: 'The reminder can go into your own calendar, so it arrives from the place you already look.'
    },
    openApptEdit: { label: 'An appointment', fn: 'openApptEdit()', domain: 'preg', depth: 'one',
      one: 'Move it, change it, or note what happened.',
      who: { stage: ['pregnancy'] } },
    openVisitPrep: { label: 'Prep for your visit', fn: 'openVisitPrep()', domain: 'preg', depth: 'chapter',
      one: 'What to ask, gathered before you go in.',
      who: { stage: ['pregnancy'] },
      earn: { on: 'appt-added' },
      what: 'The questions worth asking, gathered before you go in.',
      get: 'You leave having asked the thing you thought of at 2am, rather than recalling it in the car park.'
    },
    openPregDoctorReport: { label: 'Pregnancy doctor report', fn: 'openPregDoctorReport()', domain: 'preg', depth: 'chapter',
      one: 'One printable page of everything you have kept.',
      who: { stage: ['pregnancy'] },
      earn: { on: 'week-20' },
      what: 'Everything you have kept, on one printable page.',
      get: 'A record to hand over, instead of a conversation rebuilt from memory in ten minutes.'
    },
    openDangerSigns: { label: 'Urgent warning signs', fn: 'openDangerSigns()', domain: 'preg', depth: 'chapter',
      one: 'When to call, in plain words. Not a diagnosis, a threshold.',
      who: { stage: ['pregnancy'] },
      earn: { on: 'week-12' },
      what: 'The signs that mean call now, in plain words, taken from published guidance.',
      get: 'Something to check against at 3am. It is never a diagnosis, and calling is always the right answer when you are unsure.'
    },
    openAddCareTeam: { label: 'Care team', fn: 'openAddCareTeam()', domain: 'preg', depth: 'one',
      one: 'Midwife, obstetrician, whoever you actually call.',
      who: { stage: ['pregnancy'] },
      earn: { on: 'week-8' } },
    openBag: { label: 'Hospital bag', fn: 'openBag()', domain: 'preg', depth: 'chapter',
      one: 'A list you can tick, built for the day you will not be thinking clearly.',
      who: { stage: ['pregnancy'] },
      earn: { on: 'week-36' },
      what: 'A list you can tick off, including the things people wish they had brought.',
      get: 'Packed while you are calm, for a day you will not be thinking clearly on.'
    },
    openBirthPlan: { label: 'Birth plan', fn: 'openBirthPlan()', domain: 'preg', depth: 'chapter',
      one: 'What you would prefer, written down while it is calm.',
      who: { stage: ['pregnancy'] },
      earn: { on: 'week-34' },
      what: 'What you would prefer, written down while there is time to think about it.',
      get: 'Something you or your partner can hand over, on a day when explaining it out loud is hard.'
    },
    openBirthDetails: { label: 'Birth details', fn: 'openBirthDetails()', domain: 'preg', depth: 'one',
      one: 'What happened, when, and how much they weighed.',
      who: { stage: ['pregnancy'] },
      earn: { on: 'birth' } },
    openWelcomeBaby: { label: 'Welcome to the world', fn: 'openWelcomeBaby()', domain: 'preg', depth: 'chapter',
      one: 'The arrival screen. Pregnancy becomes a baby, and the app follows.',
      who: { stage: ['pregnancy'] },
      earn: { on: 'birth' },
      what: 'The arrival. Name, date, weight, and the first photo if you have one.',
      get: 'The pregnancy closes and the baby side of Cubby opens, with everything you kept still in place.'
    },
    openPregRecord: { label: 'Your pregnancy record', fn: 'openPregRecord()', domain: 'preg', depth: 'chapter',
      one: 'The whole pregnancy, kept read-only after the birth. Nothing is overwritten.',
      who: { stage: ['pregnancy'] },
      earn: { on: 'birth' },
      what: 'The whole pregnancy, kept read-only once the baby has arrived.',
      get: 'Nothing was overwritten to make room. A second pregnancy never writes over the first.'
    },
    openGentleMode: { label: 'Gentle mode', fn: 'openGentleMode()', domain: 'preg', depth: 'chapter',
      one: 'Turn down everything cheerful, without turning the app off.',
      who: { stage: ['pregnancy'] },
      what: 'Turns down the cheerful parts without turning the app off.',
      get: 'For when you still need the log but not the celebration around it.'
    },
    openPregnancyVisibility: { label: 'Your private pregnancy', fn: 'openPregnancyVisibility()', domain: 'preg', depth: 'chapter',
      one: 'Who sees the pregnancy at all, and what they see of it.',
      who: { stage: ['pregnancy'] , role: 'owner' },
      earn: { on: 'pregnancy-started' },
      what: 'Who can see the pregnancy at all, and what they see of it.',
      get: 'You decide when your circle knows, rather than the app deciding on your behalf.'
    },

    /* ---- Trying to conceive (6) ---- */
    openPlanningSetup: { label: 'We\'re trying', fn: 'openPlanningSetup()', domain: 'trying', depth: 'chapter',
      one: 'Tell Cubby where you are. No forecasts, and no fertile-window promises.',
      who: { stage: ['planning'] },
      what: 'Tell Cubby you are trying, and roughly where you are.',
      get: 'A calm home screen with no forecast on it. Cubby will not predict a fertile window it cannot stand behind.'
    },
    openPeriodUpdate: { label: 'Period started', fn: 'openPeriodUpdate()', domain: 'trying', depth: 'chapter',
      one: 'The one thing worth recording. Everything else is drawn from it.',
      who: { stage: ['planning'] },
      earn: { on: 'trying-started' },
      what: 'The day it started. That is the whole entry.',
      get: 'Everything Cubby shows you about your cycle is drawn from this, which is why it is the one thing worth keeping.'
    },
    openObservation: { label: 'Today I noticed', fn: 'openObservation()', domain: 'trying', depth: 'chapter',
      one: 'What you noticed, in your own words. Nothing is scored.',
      who: { stage: ['planning'] },
      earn: { on: 'trying-started' },
      what: 'What you noticed today, in your own words.',
      get: 'Nothing is scored and nothing becomes a prediction. It is a diary you can read back before an appointment.'
    },
    openObsList: { label: 'Things you noticed', fn: 'openObsList()', domain: 'trying', depth: 'one',
      one: 'The diary, read back.',
      who: { stage: ['planning'] },
      earn: { on: 'obs-3' } },
    openPositiveTest: { label: 'A positive test', fn: 'openPositiveTest()', domain: 'trying', depth: 'chapter',
      one: 'When it happens, this is the door from trying into expecting.',
      who: { stage: ['planning'] },
      earn: { on: 'positive-test' },
      what: 'Record the test, and choose whether to move into the expecting stage.',
      get: 'Nothing moves until you say so, and your cycle history stays exactly where it is.'
    },
    openTtcDoctorReport: { label: 'Doctor report', fn: 'openTtcDoctorReport()', domain: 'trying', depth: 'chapter',
      one: 'Cycles and observations on one page, for the appointment you booked.',
      who: { stage: ['planning'] },
      earn: { on: 'trying-12mo' },
      what: 'Your cycles and observations, gathered onto one page.',
      get: 'The appointment starts from a record, which is usually what makes it a shorter conversation.'
    },

    /* ---- Circle, sharing and privacy (12) ---- */
    openAddSomeone: { label: 'Add someone special', fn: 'openAddSomeone()', domain: 'circle', depth: 'chapter',
      one: 'Invite a partner, a grandparent, a nanny. What they log appears on your phone straight away.',
      who: { stage: null },
      earn: { on: 'logs-10' },
      what: 'Invite a partner, a grandparent or a nanny, by email or by a link.',
      get: 'What they log appears on your phone straight away, and what you log appears on theirs.'
    },
    openGuardians: { label: 'Guardians', fn: 'openGuardians()', domain: 'circle', depth: 'chapter',
      one: 'Who is in the circle, and what each of them can do.',
      who: { stage: null },
      earn: { on: 'second-caregiver' },
      what: 'Everyone currently in the circle, and what each of them can do.',
      get: 'You can see who has access at a glance, and remove anyone at any time.'
    },
    openNoteCompose: { label: 'Leave a note', fn: 'openNoteCompose()', domain: 'circle', depth: 'page',
      one: 'A word for whoever has baby next. Everyone, or just one person.',
      who: { stage: null },
      earn: { on: 'second-caregiver' },
      why: 'A note is a handover, not a diary entry. It is the thing you would have texted, kept where the person taking over is already looking.',
      matters: [
        ['Everyone, or one person', 'Some things are for the household and some are for one person. The card always says which, so nothing is shared by accident.'],
        ['It sits where they will see it', 'On the home screen of whoever has the baby next, rather than in a message thread that gets buried by lunchtime.'],
        ['New is marked as new', 'Reading it clears it for you and nobody else, so one person reading does not hide it from the rest.'],
        ['It is not an instruction list', 'Slight cold today, extra cuddles, last fed at eight. The tone is a person talking to a person.']
      ],
      how: [
        'Write a line and choose who it is for.',
        'It appears on their home screen, marked as unread until they read it.',
        'Pin the ones that should stay up across days.',
        'Edit or delete your own at any time.'
      ],
      payoff: 'The handover happens whether or not the two of you are awake at the same time.'
    },
    openNoteView: { label: 'A note', fn: 'openNoteView()', domain: 'circle', depth: 'one',
      one: 'The card always says who it went to.',
      who: { stage: null } },
    openMoodNote: { label: 'How are you, in yourself?', fn: 'openMoodNote()', domain: 'circle', depth: 'page',
      one: 'Never shared with your circle. Not now, not later, not by accident.',
      who: { stage: null, role: 'owner' },
      earn: { on: 'postpartum-2w' },
      why: 'Everything else in Cubby is about the baby. This one is about you, and it is the only record here that nobody else can ever see.',
      matters: [
        ['It is never shared', 'Not now, not later, not by accident, and not with the person who shares every other part of this app with you.'],
        ['There is nothing to keep up', 'No streak, no chart, no reminder if a week goes by. It is here when you want it and silent when you do not.'],
        ['A few words are enough', 'This is not a journal you have to be good at. One honest line on a hard day is the whole idea.'],
        ['Looking back is the point', 'Weeks blur completely. Reading your own words from a fortnight ago is often the first sign of what has actually changed.']
      ],
      how: [
        'Write a line about how you are, in your own words.',
        'It is stored privately to you and is not part of the shared log.',
        'Read back over previous entries whenever you want to.',
        'Nobody in your circle is ever told that it exists.'
      ],
      payoff: 'Somewhere in an app full of somebody else\'s needs, one page is yours.'
    },
    openMaternalPrivacy: { label: 'Your private health', fn: 'openMaternalPrivacy()', domain: 'circle', depth: 'chapter',
      one: 'The line around what stays yours, drawn where you can see it.',
      who: { stage: null , role: 'owner' },
      earn: { on: 'pregnancy-started' },
      what: 'The line around the records that are yours alone.',
      get: 'Written where you can read it, so trusting Cubby is not a promise you have to take on faith.'
    },
    openConsentReview: { label: 'Consent', fn: 'openConsentReview()', domain: 'circle', depth: 'one',
      one: 'What you have agreed to, and how to change it.',
      who: { stage: null } },
    openBabySheet: { label: 'Switch baby', fn: 'openBabySheet()', domain: 'circle', depth: 'one',
      one: 'Twins, or a second child. One tap between them.',
      who: { stage: null },
      earn: { on: 'second-baby-added' } },
    openFamily: { label: 'Your circle', fn: 'openFamily()', domain: 'circle', depth: 'page',
      one: 'Everyone who helps, on the same log, live. Every entry says who did it.',
      who: { stage: null },
      earn: { on: 'first-log' },
      why: 'On your own, the log is a diary. With a second person it becomes a handover, and the mental load of holding it all stops being one person\'s job. This is the part of Cubby that changes the most when somebody else joins.',
      matters: [
        ['Nobody has to ask what happened', 'What they log appears on your phone straight away, and what you log appears on theirs. The text message asking whether she has been fed stops being necessary.'],
        ['Every entry carries a name', 'Bottle 120 ml, by Nana Bear. Not to keep score, but so a question has an obvious person to ask, and so nobody is quietly assumed to have done it.'],
        ['A running timer is on every phone', 'Start a nap and everyone can see it running. Nobody opens the door of a dark room to check whether the baby is asleep.'],
        ['Some things stay only yours', 'How you are in yourself is never shared with your circle. Not now, not later, not by accident. A note can go to everyone or to one person, and the card always says which.'],
        ['Leaving is safe in both directions', 'Remove someone and their access goes, while everything they logged stays in your family\'s record. Nothing disappears from the story because a person did.']
      ],
      how: [
        'Invite by email, or send a link. A link works once and expires, so a forwarded message cannot let a stranger in.',
        'Two roles only. You own the circle. Caregivers log freely and can edit what they logged themselves.',
        'You can remove anyone at any time, and see everyone who is currently in.',
        'Grandparents, a nanny, a night nurse, the other parent. There is no view-only tier, because somebody who is helping is helping.'
      ],
      payoff: 'The question "when did she last feed?" gets answered by the phone instead of by whoever is most awake.' },
    openBearPicker: { label: 'Your bear', fn: 'openBearPicker()', domain: 'circle', depth: 'one',
      one: 'Mama Bear, Nana Bear, or a name you choose. It is how your entries are signed.',
      who: { stage: null },
      earn: { on: 'joined-circle' } },
    showAccessLost: { label: 'If you leave a circle', fn: 'showAccessLost()', domain: 'circle', depth: 'chapter',
      one: 'Your access goes and what you logged stays with the family. Nothing disappears from the story.',
      who: { stage: null },
      what: 'What happens when somebody leaves a circle, in either direction.',
      get: 'Their access goes and what they logged stays. Nothing disappears from the story because a person did.'
    },
    showInviteMismatch: { label: 'When an invite does not match', fn: 'showInviteMismatch()', domain: 'circle', depth: 'one',
      one: 'The invite was sent to a different address than the one you signed in with. Fixable, not a dead end.',
      who: { stage: null } },

    /* ---- Memories and keepsakes (17) ---- */
    openAddMoment: { label: 'Add a moment', fn: 'openAddMoment()', domain: 'memories', depth: 'chapter',
      one: 'A memory worth keeping, with the day attached.',
      who: { stage: null },
      earn: { on: 'first-photo' },
      what: 'A memory worth keeping, with the day it happened attached.',
      get: 'The moments you would otherwise only have as a photo with no story beside it.'
    },
    openAddMomentAt: { label: 'Add a moment then', fn: 'openAddMomentAt()', domain: 'memories', depth: 'one',
      one: 'Something you remembered later. Put it on the day it happened.',
      who: { stage: null } },
    openMomentDetail: { label: 'A moment', fn: 'openMomentDetail()', domain: 'memories', depth: 'one',
      one: 'One memory, in full.',
      who: { stage: null } },
    openCreateMoment: { label: 'Make a moment', fn: 'openCreateMoment()', domain: 'memories', depth: 'one',
      one: 'Start from a prompt when you cannot think of one.',
      who: { stage: null } },
    openPregMoment: { label: 'A pregnancy moment', fn: 'openPregMoment()', domain: 'memories', depth: 'one',
      one: 'The ones from before they arrived.',
      who: { stage: null } },
    openJourneyRename: { label: 'Name this journey', fn: 'openJourneyRename()', domain: 'memories', depth: 'one',
      one: 'Call it what you call it.',
      who: { stage: null },
      earn: { on: 'moments-5' } },
    openMemoryCard: { label: 'Memory card', fn: 'openMemoryCard()', domain: 'memories', depth: 'page',
      one: 'A month, a photo and a line, made into something you would actually print.',
      who: { stage: null },
      earn: { on: '3-photos' },
      why: 'The photos are already on your phone. This is the small amount of effort that turns a few of them into something you would actually print, at the point when doing it properly feels impossible.',
      matters: [
        ['It uses what you already took', 'No shoot to arrange, no perfect photo required. The month and a line beside a picture is the whole card.'],
        ['A line beats a caption', 'What she was like this month, in a sentence. That is the part you will not remember and the part worth keeping.'],
        ['Private until you decide', 'Nothing is public and nothing is shared until you choose to share that one thing.'],
        ['It is a keepsake, not a post', 'Made to be kept or printed rather than to be performed for anybody.']
      ],
      how: [
        'Pick a photo from your album.',
        'Add the month and a line about how they were.',
        'Save it, and it stays in your kept memories.',
        'Share or print it only if you want to.'
      ],
      payoff: 'A year of months exists as something you can hold, instead of four thousand photos you never sorted.'
    },
    openBirthPoster: { label: 'Birth poster', fn: 'openBirthPoster()', domain: 'memories', depth: 'chapter',
      one: 'The details of the day, set as something to put on a wall.',
      who: { stage: null },
      earn: { on: 'birth' },
      what: 'The details of the day, set as something you could put on a wall.',
      get: 'A keepsake made from facts you already entered, with nothing else to fill in.'
    },
    openThenNow: { label: 'Then vs Now', fn: 'openThenNow()', domain: 'memories', depth: 'chapter',
      one: 'Two photos, months apart. The one that always lands.',
      who: { stage: null },
      earn: { on: 'photos-10' },
      what: 'Two photos of the same little person, months apart, side by side.',
      get: 'The one that makes people stop scrolling, including you.'
    },
    openKeptMemories: { label: 'Kept memories', fn: 'openKeptMemories()', domain: 'memories', depth: 'one',
      one: 'What you chose to keep, gathered in one place.',
      who: { stage: null } },
    openRelCapture: { label: 'A photo with someone', aka: ['a photo with'], fn: 'openRelCapture()', domain: 'memories', depth: 'chapter',
      one: 'The first time they meet, and every time after.',
      who: { stage: null },
      earn: { on: 'second-caregiver' },
      what: 'A photo with one particular person, kept together over time.',
      get: 'The first time they met and every time since, in one place rather than scattered across a camera roll.'
    },
    openRelView: { label: 'With someone', fn: 'openRelView()', domain: 'memories', depth: 'one',
      one: 'Every photo with one person, over time.',
      who: { stage: null } },
    openPhotoPrep: { label: 'Make it just right', fn: 'openPhotoPrep()', domain: 'memories', depth: 'one',
      one: 'Crop it, straighten it, warm it up. Nothing leaves your phone to do it.',
      who: { stage: null },
      earn: { on: 'first-photo' } },
    openAvatarPicker: { label: 'Profile picture', fn: 'openAvatarPicker()', domain: 'memories', depth: 'one',
      one: 'A photo or a bear. Change it whenever.',
      who: { stage: null },
      earn: { on: 'first-photo' } },
    openPetSetup: { label: 'Your pet', fn: 'openPetSetup()', domain: 'memories', depth: 'one',
      one: 'They are family too, and they show up in the story.',
      who: { stage: null } },
    openGuessGame: { label: 'Family games', fn: 'openGuessGame()', domain: 'memories', depth: 'chapter',
      one: 'Boy or girl guesses from your circle. A guess is never treated as a fact.',
      who: { stage: null },
      earn: { on: 'week-20' },
      what: 'Your circle guesses boy or girl before anybody knows.',
      get: 'A guess is never treated as a fact and never joins the record. Any myths in it are badged as myths.'
    },
    openPrintable: { label: 'Printable', fn: 'openPrintable()', domain: 'memories', depth: 'one',
      one: 'A version made for paper, not for a screen.',
      who: { stage: null } },

    /* ---- Setup, account and data (16) ---- */
    openAddBaby: { label: 'Add a baby', fn: 'openAddBaby()', domain: 'account', depth: 'chapter',
      one: 'A first, a second, or twins. Each gets their own everything.',
      who: { stage: null },
      what: 'A first baby, a second, or twins.',
      get: 'Each one gets their own logs, their own schedule and their own album, and you switch between them in one tap.'
    },
    openBabyProfile: { label: 'Baby\'s profile', fn: 'openBabyProfile()', domain: 'account', depth: 'one',
      one: 'Name, birthday, and the details the rest of the app reads from.',
      who: { stage: null } },
    openStageSheet: { label: 'Change stage', aka: ['s stage'], fn: 'openStageSheet()', domain: 'account', depth: 'chapter',
      one: 'Trying, expecting, baby, child. You can move, and nothing is lost.',
      who: { stage: null },
      earn: { on: '18-months' },
      what: 'Move between trying, expecting, baby and child.',
      get: 'Nothing is lost when you move. What you kept in an earlier stage stays exactly where it was.'
    },
    /* aka, because the sheet asks a question rather than announcing a noun, and sheetDot matches on
       the heading. label is what the How to use Cubby list shows; aka is what the <h2> actually says. */
    openHouseholdName: { label: 'Your family\'s name', aka: ['what shall we call your family'],
      fn: 'openHouseholdName()', domain: 'account', depth: 'one',
      one: 'What an invited person sees, so they know whose Cubby they are joining. Everyone in the circle sees it.',
      who: { stage: null } },
    openSettings: { label: 'Settings', fn: 'openSettings()', domain: 'account', depth: 'one',
      one: 'Everything about how Cubby behaves, in one list.',
      who: { stage: null } },
    openQuickSettings: { label: 'Quick log button', fn: 'openQuickSettings()', domain: 'account', depth: 'one',
      one: 'Choose the four logs on your home screen. Yours, not your household\'s.',
      who: { stage: null },
      earn: { on: 'logs-10' } },
    openAppearance: { label: 'Appearance', fn: 'openAppearance()', domain: 'account', depth: 'chapter',
      one: 'System, light or night, and it is yours alone. Your partner keeps theirs.',
      who: { stage: null },
      earn: { on: 'month-1' },
      what: 'System, light, or night.',
      get: 'It is yours alone. Changing it does not change what your partner sees on their phone.'
    },
    openReminders: { label: 'Reminders', fn: 'openReminders()', domain: 'account', depth: 'chapter',
      one: 'Due medicine only. Cubby will not nag you about logging.',
      who: { stage: null },
      earn: { on: 'med-added' },
      what: 'Notifications for due medicine, and nothing else.',
      get: 'Cubby will not interrupt you to ask for a log. A dose is the only thing worth a notification.'
    },
    openDataSheet: { label: 'Your data', fn: 'openDataSheet()', domain: 'account', depth: 'chapter',
      one: 'Where it lives, who can reach it, and how to take it with you.',
      who: { stage: null },
      earn: { on: 'month-2' },
      what: 'Where your data lives, who can reach it, and how to take it with you.',
      get: 'The answers in one place, so trusting Cubby is a decision you can actually check.'
    },
    openDeleteRequest: { label: 'Delete data', fn: 'openDeleteRequest()', domain: 'account', depth: 'one',
      one: 'Remove what you no longer want kept.',
      who: { stage: null } },
    openDeleteAccount: { label: 'Delete my account', fn: 'openDeleteAccount()', domain: 'account', depth: 'chapter',
      one: 'Always yours to make. The shared log stays with the circle; your name comes off it.',
      who: { stage: null },
      what: 'Removes you, and the records that are private to you.',
      get: 'It is always yours to do and never needs anyone else to agree. The shared log stays with the circle, with your name taken off it.'
    },
    openPro: { label: 'Cubby Pro', fn: 'openPro()', domain: 'account', depth: 'chapter',
      one: 'What Pro adds. Registration only until October 2026, and the copy has to say so.',
      who: { stage: null },
      what: 'What Pro adds, and how to register your interest in it.',
      get: 'You can register now. Nothing is charged, and Pro does not go on sale until later this year.'
    },
    openProPortal: { label: 'Manage Pro', fn: 'openProPortal()', domain: 'account', depth: 'one',
      one: 'Your subscription, when there is one to manage.',
      who: { stage: null } },
    showSignIn: { label: 'Signing in', fn: 'showSignIn()', domain: 'account', depth: 'chapter',
      one: 'Google, Apple, or a link by email. No password to forget at 3am.',
      who: { stage: null },
      what: 'Continue with Google, with Apple, or with a link sent to your email.',
      get: 'No password to invent at midnight, and none to forget at 3am.'
    },
    openForm: { label: 'Sign in by email', fn: 'openForm()', domain: 'account', depth: 'one',
      one: 'A one-time link, sent to you. Nothing to remember.',
      who: { stage: null } },
    openFirstRun: { label: 'Setting up', fn: 'openFirstRun()', domain: 'account', depth: 'chapter',
      one: 'Stage, details, who you are, and who else should see it. Four steps, then you are in.',
      who: { stage: null },
      what: 'Four steps: your stage, the details, who you are, and who else should see it.',
      get: 'One idea per screen, and every one of them can be changed later.'
    },
    openFeedback: { label: 'Send feedback', fn: 'openFeedback()', domain: 'account', depth: 'one',
      one: 'Tell us what is broken or missing. It reaches a person.',
      who: { stage: null },
      earn: { on: 'month-1' } },
  };

  var NO_TEACH = {
    /* Plumbing, not capability */
    openDateTimePicker: 'The shared date and time picker. One component, reused everywhere, by design.',
    openTimePicker: 'Time half of the same component.',
    openWhenPicker: 'The \'when did this happen\' control inside log sheets.',
    openFeverSymptomNudge: 'The answer to logging Fever without a number. Like openBPConcern it is a consequence of saving something, never a place a parent navigates to, and it says everything it has to say on screen.',
    openBPConcern: 'The answer to a raised or severe blood-pressure reading. It is a consequence of saving one, never something a mother navigates to, and it explains itself in full on screen. Teaching it as a capability would file "your reading was high" under things to go and look at.',
    showConnTrouble: 'A connection-trouble card shown during sign-in. It is an error state, not a capability, and it explains itself on screen.',
    showStatus: 'Inline status text during sign-in.',
    showCodeEntry: 'The second panel of the code sign-in: swaps the email field for the six-digit box. A step inside one flow, not a capability of its own, and the panel explains itself on screen.',
    showCodeBox: 'Reveals the six-digit box and wires it, shared by both sign-in panels so the two routes cannot drift apart. Plumbing inside a flow, and the panel that calls it does the explaining.',
    showSent: 'Confirms the sign-in email went out.',
    openSheet: 'The sheet primitive itself. 131 call sites because it is the frame, not a feature.',
    showLoader: 'A loading spinner. It has no content of its own to explain.',
    openPickerOverlay: 'The searchable-dropdown primitive.',
    openDateModal: 'The shared date and time picker.',
    openArticle: 'Renders a read. The reading room is the capability; this is its renderer.',
    openReadCarousel: 'Renders the swipeable reads. Same reason.',
    showCountryList: 'Opens a picker\'s list. Helper inside a form field.',
    showDeletedGoodbye: 'Terminal confirmation screen after deletion. Nothing left to teach.',

    /* Dormant behind a flag */
    openDenChores: 'FEATURES.den = false.',
    openDenExpenses: 'FEATURES.den = false.',
    openDenMeals: 'FEATURES.den = false.',
    openDenShopping: 'FEATURES.den = false.',
    openDenStaff: 'FEATURES.den = false.',
    openDenWeights: 'FEATURES.den = false.',

    /* Already a teaching cue */
    showReady: 'Setup-complete screen. Part of first-run, not a thing to explain.',
    openFeverNudge: 'Already the earned nudge for the visit summary. Governed by the ledger.',
    openKeepsakeNudge: 'Already the earned nudge for memory cards.',
    openInstall: 'Already a prompt. Competes for the token like any other.',
    showBirthArrival: 'Arrival prompt. Fires on the birth transition.',
    openOnboardInvite: 'The last screen of first-run. Part of the flow, not a thing to explain.',
  };

  window.CubbyTeachData = { rows: TEACH, noTeach: NO_TEACH };
})();
