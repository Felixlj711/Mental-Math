// Market sizing cases for the UK and Europe, run as a guided case:
//   1. clarify the question   2. plan the approach
//   3. estimate stage by stage   4. sense check
// Stages are facts (can be wrong, ±20%), assumptions (never wrong, just
// compared with mine) and calculations (checked against YOUR numbers).

import { fmtNum, roundSig, withCommas } from './format.js';
import { createRng } from './rng.js';

export const SIZING_TOLERANCE = 0.2; // final answer and facts: within ±20%
export const CALC_TOLERANCE = 0.1; // your maths, using your own numbers

// Approximate figures (2023/24), rounded the way you'd quote them in a case.
export const COUNTRIES = [
  { id: 'uk', name: 'the UK', label: 'UK', pop: 68e6, hh: 28e6, cur: '£' },
  { id: 'de', name: 'Germany', label: 'Germany', pop: 84e6, hh: 41e6, cur: '€' },
  { id: 'fr', name: 'France', label: 'France', pop: 68e6, hh: 30e6, cur: '€' },
  { id: 'it', name: 'Italy', label: 'Italy', pop: 59e6, hh: 26e6, cur: '€' },
  { id: 'es', name: 'Spain', label: 'Spain', pop: 48e6, hh: 19e6, cur: '€' },
  { id: 'nl', name: 'the Netherlands', label: 'Netherlands', pop: 18e6, hh: 8e6, cur: '€' },
];

export const CITIES = [
  { id: 'london', name: 'London', label: 'London', pop: 9e6, cur: '£', city: true },
  { id: 'manchester', name: 'Greater Manchester', label: 'Greater Manchester', pop: 2.9e6, cur: '£', city: true },
  { id: 'paris', name: 'the Paris region (Île-de-France)', label: 'Paris region', pop: 12e6, cur: '€', city: true },
  { id: 'berlin', name: 'Berlin', label: 'Berlin', pop: 3.8e6, cur: '€', city: true },
  { id: 'madrid', name: 'Madrid', label: 'Madrid', pop: 3.4e6, cur: '€', city: true },
  { id: 'rome', name: 'Rome', label: 'Rome', pop: 2.8e6, cur: '€', city: true },
  { id: 'amsterdam', name: 'Amsterdam', label: 'Amsterdam', pop: 0.9e6, cur: '€', city: true },
];

// The cheat sheet on the market sizing screen.
export const KEY_NUMBERS = [
  ...COUNTRIES.map((c) => `${c.label}: ${fmtNum(c.pop)} people · ${fmtNum(c.hh)} households`),
  'EU: 450M people · 200M households · England: 57M people',
  `Cities: ${CITIES.map((c) => `${c.label} ${fmtNum(c.pop)}`).join(' · ')}`,
  'Average household ≈ 2.3 people',
  'Adults (18+) ≈ 80% of the population',
  'Life expectancy ≈ 80 years, so each year of age ≈ population ÷ 80',
  'About 1 car for every 2 people',
  'About 220–250 working days a year',
];

// ---------- building blocks ----------
const pct = (x) => x / 100;
const n = (x) => fmtNum(roundSig(x, 3));
const fixed = (x, d) => String(Number(x.toFixed(d)));

const fact = (key, ask, plan, unit, value, note) => ({ key, kind: 'fact', ask, plan, unit, value, note });
const assume = (key, ask, plan, unit, value, note, money = false) => ({ key, kind: 'assume', ask, plan, unit, value, note, money });
const calc = (key, ask, plan, unit, f, formula, money = false) => ({ key, kind: 'calc', ask, plan, unit, f, formula, money });

const popStep = (R) =>
  fact('pop', `What is the population of ${R.name}?`, `Estimate the population of ${R.name}`, 'people', R.pop, `${R.label} has about ${fmtNum(R.pop)} people.`);
const lifeStep = () =>
  fact('life', 'What is life expectancy in Western Europe?', 'Use life expectancy to size one age group', 'years', 80, 'About 80 years, so each year of age is roughly population ÷ 80.');

// Households: a known fact for countries, derived from household size for cities.
function householdSteps(R) {
  if (!R.city) {
    return [
      fact('hh', `How many households are there in ${R.name}?`, `Estimate the number of households in ${R.name}`, 'households', R.hh,
        `${R.label} has about ${fmtNum(R.hh)} households (≈ ${fixed(R.pop / R.hh, 1)} people each).`),
    ];
  }
  return [
    popStep(R),
    assume('size', 'How many people live in an average household?', 'Estimate people per household', 'people', 2.3, 'About 2.3 across Europe, a bit lower in big cities.'),
    calc('hh', 'So how many households is that?', 'Divide to get households', 'households', (v) => v.pop / v.size, (v) => `${n(v.pop)} ÷ ${v.size}`),
  ];
}

const facts = (R, extra = []) => [
  `${R.label} population ≈ ${fmtNum(R.pop)}`,
  ...(R.city ? [] : [`${R.label} households ≈ ${fmtNum(R.hh)}`]),
  ...extra,
];
const LIFE = 'Life expectancy ≈ 80 years';
const CARS = 'About 1 car for every 2 people';

// ---------- cases ----------
// scope: which regions a case is used for. build(R) returns the case.
export const SIZING_TEMPLATES = [
  {
    id: 'sizing.coffee',
    name: 'Café coffees per day',
    scope: 'city',
    build: (R) => ({
      question: `How many cups of coffee are bought in cafés in ${R.name} on a typical day?`,
      clarify: {
        questions: [
          'Only cafés and coffee shops, or also offices, vending machines and supermarkets?',
          'Residents only, or commuters and tourists too?',
          'Any coffee drink, or only black coffee?',
        ],
        answer: 'Cafés and coffee shops only, bought by residents, and any coffee drink counts.',
      },
      facts: facts(R, ['Adults ≈ 80% of the population']),
      steps: [
        popStep(R),
        assume('adults', 'What share of people are adults?', 'Estimate the share of adults', '%', 80, 'Roughly 80% are 18 or over, and children rarely buy coffee.'),
        assume('buy', 'What share of adults buy a café coffee on a given day?', 'Estimate how many adults buy a café coffee each day', '%', 30,
          'Maybe 1 in 3: plenty of commuters do, but many people make coffee at home.'),
        assume('cups', 'How many cups does each of them buy that day?', 'Estimate cups per buyer', 'cups', 1.2, 'Most have one, some have two.'),
        calc('total', 'So how many café coffees are bought a day?', 'Multiply everything together', 'cups a day',
          (v) => v.pop * pct(v.adults) * pct(v.buy) * v.cups, (v) => `${n(v.pop)} × ${v.adults}% × ${v.buy}% × ${v.cups}`),
      ],
      sense: (v) => `That's about ${fixed(v.total / v.pop, 2)} café coffees per resident per day, one every ${Math.round(v.pop / v.total)} days or so. Plausible for a big European city.`,
    }),
  },
  {
    id: 'sizing.commute',
    name: 'Public transport commutes',
    scope: 'city',
    build: (R) => ({
      question: `How many commuting trips are made on public transport in ${R.name} on a weekday?`,
      clarify: {
        questions: ['Commuting to work only, or also school and shopping trips?', 'Does a return journey count as one trip or two?', 'Bus, metro, tram and rail all count?'],
        answer: 'Trips to and from work only; each one-way journey is one trip; all public transport counts.',
      },
      facts: facts(R),
      steps: [
        popStep(R),
        assume('work', 'What share of residents are in work?', 'Estimate the share of people in work', '%', 50, 'About half: the rest are children, students, retirees and people not working.'),
        assume('pt', 'What share of workers commute by public transport?', 'Estimate how many commute by public transport', '%', 40,
          'Big European cities have strong transit, so maybe 40%. It would be less in car-heavy cities, more in central London or Paris.'),
        assume('trips', 'How many trips does each commuter make a day?', 'Count trips per commuter', 'trips', 2, 'There and back.'),
        calc('total', 'So how many commuting trips a weekday?', 'Multiply everything together', 'trips a day',
          (v) => v.pop * pct(v.work) * pct(v.pt) * v.trips, (v) => `${n(v.pop)} × ${v.work}% × ${v.pt}% × ${v.trips}`),
      ],
      sense: (v) => `That's ${fixed(v.total / v.pop, 2)} commuting trips per resident a day. Plausible, given that half the city doesn't work.`,
    }),
  },
  {
    id: 'sizing.hairdressers',
    name: 'Number of hairdressers',
    scope: 'both',
    build: (R) => ({
      question: `Roughly how many hairdressers and barbers work in ${R.name}?`,
      clarify: {
        questions: ['Hairdressers and barbers both?', 'People who cut hair, or the number of salons?', 'Full-time equivalents, or everyone including part-timers?'],
        answer: 'Count people (hairdressers and barbers), as full-time equivalents.',
      },
      facts: facts(R),
      steps: [
        popStep(R),
        assume('cuts', 'How many haircuts does a person get a year?', 'Estimate haircuts per person per year', 'haircuts', 6,
          'Men every 6–8 weeks, women less often but with longer appointments, children fewer: about 6 on average.'),
        calc('demand', 'So how many haircuts a year in total?', 'Work out total haircuts per year', 'haircuts a year', (v) => v.pop * v.cuts, (v) => `${n(v.pop)} × ${v.cuts}`),
        assume('perDay', 'How many cuts does a hairdresser do a day?', 'Estimate cuts per hairdresser per day', 'cuts', 8, 'About one an hour over a working day.'),
        assume('days', 'How many days a year do they work?', 'Estimate working days per year', 'days', 250, 'Five days a week, minus holidays.'),
        calc('total', 'So how many hairdressers are needed?', 'Divide demand by what one hairdresser can do', 'hairdressers',
          (v) => v.demand / (v.perDay * v.days), (v) => `${n(v.demand)} ÷ (${v.perDay} × ${v.days})`),
      ],
      sense: (v) => `That's one hairdresser for every ${withCommas(Math.round(v.pop / v.total), 0)} people, or a few salons per neighbourhood. Sounds about right.`,
    }),
  },
  {
    id: 'sizing.dentists',
    name: 'Number of dentists',
    scope: 'country',
    build: (R) => ({
      question: `Roughly how many dentists are there in ${R.name}?`,
      clarify: {
        questions: ['Practising dentists only, or also hygienists and assistants?', 'Public and private practices?'],
        answer: 'Practising dentists, in both public and private practice.',
      },
      facts: facts(R),
      steps: [
        popStep(R),
        assume('visits', 'How many dental visits does a person make a year?', 'Estimate dental visits per person per year', 'visits', 2,
          'Check-ups are recommended twice a year. Some go less, others need treatment visits, so 2 is a fair average.'),
        assume('perDay', 'How many patients does a dentist see a day?', 'Estimate patients per dentist per day', 'patients', 15, 'About 2 an hour over 7–8 hours.'),
        assume('days', 'How many days a year does a dentist work?', 'Estimate working days per year', 'days', 220, 'Four to five days a week, minus holidays.'),
        calc('total', 'So how many dentists?', 'Divide total visits by visits one dentist can handle', 'dentists',
          (v) => (v.pop * v.visits) / (v.perDay * v.days), (v) => `${n(v.pop)} × ${v.visits} ÷ (${v.perDay} × ${v.days})`),
      ],
      sense: (v) => `That's one dentist per ${withCommas(Math.round(v.pop / v.total), 0)} people. Western Europe is roughly 1 per 1,500–2,000, so plausible.`,
    }),
  },
  {
    id: 'sizing.smartphones',
    name: 'Smartphones sold per year',
    scope: 'country',
    build: (R) => ({
      question: `How many smartphones are sold in ${R.name} each year?`,
      clarify: { questions: ['New phones only, or second-hand too?', 'Consumer phones only, or business phones too?'], answer: 'New phones, for consumers and businesses.' },
      facts: facts(R),
      steps: [
        popStep(R),
        assume('own', 'What share of people own a smartphone?', 'Estimate smartphone ownership', '%', 85, 'Almost every adult and teenager, fewer young children and elderly: about 85%.'),
        assume('years', 'How often is a phone replaced, in years?', 'Estimate the replacement cycle', 'years', 3, 'Most people upgrade every 2–4 years.'),
        calc('total', 'So how many phones are sold a year?', 'Owners ÷ replacement cycle', 'phones a year', (v) => (v.pop * pct(v.own)) / v.years, (v) => `${n(v.pop)} × ${v.own}% ÷ ${v.years}`),
      ],
      sense: (v) => `About ${fixed(v.total / v.pop, 2)} new phones per person a year, i.e. one every ${fixed(v.pop / v.total, 1)} years per person. Sensible.`,
    }),
  },
  {
    id: 'sizing.washing',
    name: 'Washing machines sold per year',
    scope: 'country',
    build: (R) => ({
      question: `How many washing machines are sold in ${R.name} each year?`,
      clarify: { questions: ['Household machines only, or also laundrettes and hotels?', 'Replacements and first-time buyers?'], answer: 'Household machines, all purchases.' },
      facts: facts(R),
      steps: [
        ...householdSteps(R),
        assume('own', 'What share of households own a washing machine?', 'Estimate ownership', '%', 95, 'Nearly all; a few rely on shared or communal machines.'),
        assume('life', 'How many years does a machine last?', 'Estimate the replacement cycle', 'years', 10, 'Roughly 8–12 years.'),
        calc('total', 'So how many machines are sold a year?', 'Owners ÷ lifetime', 'machines a year', (v) => (v.hh * pct(v.own)) / v.life, (v) => `${n(v.hh)} × ${v.own}% ÷ ${v.life}`),
      ],
      sense: (v) => `About 1 new machine per ${Math.round(v.hh / v.total)} households a year, which matches a ~10-year lifetime.`,
    }),
  },
  {
    id: 'sizing.nappies',
    name: 'Nappies used per year',
    scope: 'country',
    build: (R) => ({
      question: `How many disposable nappies (diapers) are used in ${R.name} each year?`,
      clarify: { questions: ['Disposable only, or reusable cloth nappies too?', 'Baby nappies only, or adult products too?'], answer: 'Disposable baby nappies only.' },
      facts: facts(R, [LIFE]),
      steps: [
        popStep(R),
        lifeStep(),
        calc('births', 'So roughly how many babies are born each year?', 'Population ÷ life expectancy ≈ births per year', 'babies', (v) => v.pop / v.life, (v) => `${n(v.pop)} ÷ ${v.life}`),
        assume('years', 'How many years does a child wear nappies?', 'Estimate years in nappies', 'years', 2.5, 'Most are potty-trained between 2 and 3.'),
        assume('perDay', 'How many nappies a day on average?', 'Estimate nappies per day', 'nappies', 5, 'More for newborns (8+), fewer for toddlers (3–4).'),
        calc('total', 'So how many nappies a year?', 'Babies in nappies × nappies a day × 365', 'nappies a year',
          (v) => v.births * v.years * v.perDay * 365, (v) => `${n(v.births)} × ${v.years} × ${v.perDay} × 365`),
      ],
      sense: (v) => `About ${withCommas(Math.round(v.total / (v.births * v.years)), 0)} nappies per child a year. Parents would agree that's roughly right. (Real birth rates are a little lower than population ÷ 80 in most of Europe.)`,
    }),
  },
  {
    id: 'sizing.weddings',
    name: 'Weddings per year',
    scope: 'country',
    build: (R) => ({
      question: `How many weddings take place in ${R.name} each year?`,
      clarify: { questions: ['Weddings of residents, or weddings held in the country (destination weddings)?', 'Civil ceremonies and partnerships too?'], answer: 'All weddings of residents, including civil ceremonies.' },
      facts: facts(R, [LIFE]),
      steps: [
        popStep(R),
        lifeStep(),
        calc('cohort', 'So how many people are in one year of age?', 'Population ÷ life expectancy ≈ one age group', 'people', (v) => v.pop / v.life, (v) => `${n(v.pop)} ÷ ${v.life}`),
        assume('marry', 'What share of people marry at some point?', 'Estimate the share who marry', '%', 50, 'Roughly half; remarriages roughly offset those who never marry.'),
        calc('total', 'So how many weddings a year? (2 people per wedding)', 'Age group × share ÷ 2 people per wedding', 'weddings a year',
          (v) => (v.cohort * pct(v.marry)) / 2, (v) => `${n(v.cohort)} × ${v.marry}% ÷ 2`),
      ],
      sense: (v) => `That's about ${fixed((v.total / v.pop) * 1000, 1)} weddings per 1,000 people a year. Europe is around 3–4, so plausible.`,
    }),
  },
  {
    id: 'sizing.cinema',
    name: 'Cinema box office',
    scope: 'both',
    build: (R) => ({
      question: `What is the annual cinema box office in ${R.name}, in ${R.cur}?`,
      clarify: { questions: ['Ticket sales only, or snacks and drinks too?', 'Residents only, or everyone buying a ticket there?'], answer: 'Ticket revenue only, from everyone buying a ticket.' },
      facts: facts(R),
      steps: [
        popStep(R),
        assume('visits', 'How many times does a person go to the cinema a year?', 'Estimate cinema visits per person per year', 'visits', 2, 'Some go monthly, many never: about 2 on average.'),
        assume('price', `What is the average ticket price, in ${R.cur}?`, 'Estimate the average ticket price', R.cur, 9, 'Around 8–12 in big cities, less with discounts and matinees.', true),
        calc('total', 'So what is the box office per year?', 'Visits × price', `${R.cur} a year`, (v) => v.pop * v.visits * v.price, (v) => `${n(v.pop)} × ${v.visits} × ${R.cur}${v.price}`, true),
      ],
      sense: (v) => `That's ${R.cur}${Math.round(v.total / v.pop)} per person a year on cinema tickets. Plausible.`,
    }),
  },
  {
    id: 'sizing.gyms',
    name: 'Gym membership market',
    scope: 'country',
    build: (R) => ({
      question: `How much is the gym membership market in ${R.name} worth per year, in ${R.cur}?`,
      clarify: { questions: ['Membership fees only, or also personal training and classes?', 'Budget gyms and premium clubs both?'], answer: 'Membership fees only, for all types of gym.' },
      facts: facts(R, ['Adults ≈ 80% of the population']),
      steps: [
        popStep(R),
        assume('adults', 'What share of people are adults?', 'Estimate the share of adults', '%', 80, 'Roughly 80% are 18 or over.'),
        assume('members', 'What share of adults have a gym membership?', 'Estimate gym penetration', '%', 15, 'Around 1 in 7 adults in Western Europe.'),
        assume('fee', `What is an average monthly fee, in ${R.cur}?`, 'Estimate the average monthly fee', R.cur, 35, 'Budget gyms ~20–25, premium clubs 60+: about 35 on average.', true),
        calc('total', 'So what is the market worth per year?', 'Members × fee × 12 months', `${R.cur} a year`,
          (v) => v.pop * pct(v.adults) * pct(v.members) * v.fee * 12, (v) => `${n(v.pop)} × ${v.adults}% × ${v.members}% × ${R.cur}${v.fee} × 12`, true),
      ],
      sense: (v) => `About ${n(v.pop * pct(v.adults) * pct(v.members))} members paying ${R.cur}${Math.round(v.fee * 12)} a year. A multi-billion market for a big country feels right.`,
    }),
  },
  {
    id: 'sizing.streaming',
    name: 'Video streaming market',
    scope: 'country',
    build: (R) => ({
      question: `How much do households in ${R.name} spend on video streaming subscriptions per year, in ${R.cur}?`,
      clarify: { questions: ['Video only (Netflix, Disney+ …), or music too?', 'Paid subscriptions only, or also free, ad-supported services?'], answer: 'Paid video subscriptions only.' },
      facts: facts(R),
      steps: [
        ...householdSteps(R),
        assume('share', 'What share of households pay for video streaming?', 'Estimate the share that subscribe', '%', 60, 'Most households, but not older or price-sensitive ones: about 60%.'),
        assume('services', 'How many services does a subscribing household have?', 'Estimate services per household', 'services', 1.5, 'Often one big service plus a second now and then.'),
        assume('price', `What does one service cost a month, in ${R.cur}?`, 'Estimate the monthly price', R.cur, 10, 'About 6–15 depending on the plan.', true),
        calc('total', 'So what is annual spend?', 'Households × share × services × price × 12', `${R.cur} a year`,
          (v) => v.hh * pct(v.share) * v.services * v.price * 12, (v) => `${n(v.hh)} × ${v.share}% × ${v.services} × ${R.cur}${v.price} × 12`, true),
      ],
      sense: (v) => `About ${R.cur}${Math.round(v.total / v.hh)} per household a year, or ${R.cur}${Math.round(v.total / v.hh / 12)} a month on average. Plausible.`,
    }),
  },
  {
    id: 'sizing.petfood',
    name: 'Pet food market',
    scope: 'country',
    build: (R) => ({
      question: `How big is the cat and dog food market in ${R.name} per year, in ${R.cur}?`,
      clarify: { questions: ['Cats and dogs only, or all pets?', 'Food and treats only, or accessories and vet bills too?'], answer: 'Cat and dog food and treats only.' },
      facts: facts(R),
      steps: [
        ...householdSteps(R),
        assume('share', 'What share of households have a cat or dog?', 'Estimate pet ownership', '%', 45, 'Roughly 40–50% in most of Western Europe.'),
        assume('spend', `How much does a pet household spend on food a month, in ${R.cur}?`, 'Estimate monthly food spend', R.cur, 30, 'A cat costs less, a big dog more: about 30 on average.', true),
        calc('total', 'So how big is the market per year?', 'Pet households × spend × 12', `${R.cur} a year`, (v) => v.hh * pct(v.share) * v.spend * 12, (v) => `${n(v.hh)} × ${v.share}% × ${R.cur}${v.spend} × 12`, true),
      ],
      sense: (v) => `About ${R.cur}${Math.round(v.spend * 12)} per pet household a year, a few billion for a large country. Plausible.`,
    }),
  },
  {
    id: 'sizing.teachers',
    name: 'School teachers',
    scope: 'country',
    build: (R) => ({
      question: `Roughly how many school teachers are there in ${R.name}?`,
      clarify: { questions: ['Primary and secondary only, or universities too?', 'Full-time equivalents, or everyone who teaches?'], answer: 'Primary and secondary schools, as full-time equivalent teachers.' },
      facts: facts(R, [LIFE]),
      steps: [
        popStep(R),
        lifeStep(),
        assume('years', 'How many years does a child spend at school?', 'Estimate years of schooling', 'years', 13, 'Roughly ages 5 to 17.'),
        calc('pupils', 'So how many pupils are there?', 'Population ÷ life expectancy × school years', 'pupils', (v) => (v.pop / v.life) * v.years, (v) => `${n(v.pop)} ÷ ${v.life} × ${v.years}`),
        assume('ratio', 'How many pupils are there per teacher?', 'Estimate pupils per teacher', 'pupils', 18, 'Classes are 25–30, but teachers also plan and specialise: about 18 per teacher overall.'),
        calc('total', 'So how many teachers?', 'Pupils ÷ pupils per teacher', 'teachers', (v) => v.pupils / v.ratio, (v) => `${n(v.pupils)} ÷ ${v.ratio}`),
      ],
      sense: (v) => `That's about 1 teacher per ${Math.round(v.pop / v.total)} people, roughly 1–2% of the workforce. Plausible.`,
    }),
  },
  {
    id: 'sizing.petrol',
    name: 'Petrol stations',
    scope: 'country',
    build: (R) => ({
      question: `Roughly how many petrol stations are there in ${R.name}?`,
      clarify: { questions: ['Public stations only, or also private fleet depots?', 'Do EV charging sites count?'], answer: 'Public petrol stations only.' },
      facts: facts(R, [CARS]),
      steps: [
        popStep(R),
        assume('perCar', 'How many people are there per car?', 'Estimate people per car', 'people', 2, 'About one car for every two people in Western Europe.'),
        calc('cars', 'So how many cars are there?', 'Population ÷ people per car', 'cars', (v) => v.pop / v.perCar, (v) => `${n(v.pop)} ÷ ${v.perCar}`),
        assume('fills', 'How many times a year is a car filled up?', 'Estimate fill-ups per car per year', 'fill-ups', 50, 'About once a week.'),
        assume('capacity', 'How many fill-ups does a station handle a day?', 'Estimate fill-ups per station per day', 'fill-ups', 600, 'Say 8 pumps × ~75 cars a day each.'),
        calc('total', 'So how many stations?', 'Fill-ups a year ÷ (station capacity × 365)', 'stations',
          (v) => (v.cars * v.fills) / (v.capacity * 365), (v) => `${n(v.cars)} × ${v.fills} ÷ (${v.capacity} × 365)`),
      ],
      sense: (v) => `About ${withCommas(Math.round(v.cars / v.total), 0)} cars per station. Plausible, though rural stations serve far fewer.`,
    }),
  },
  {
    id: 'sizing.piano',
    name: 'Piano tuners',
    scope: 'both',
    build: (R) => ({
      question: `Roughly how many piano tuners work in ${R.name}?`,
      clarify: { questions: ['Only people who tune pianos for a living?', 'Pianos in homes only, or schools, churches and concert halls too?'], answer: 'Full-time tuners; homes are the main market, so start there.' },
      facts: facts(R),
      steps: [
        ...householdSteps(R),
        assume('share', 'What share of households own a piano?', 'Estimate piano ownership', '%', 3, 'Maybe 1 in 30 homes.'),
        assume('tunings', 'How many tunings does a piano get a year?', 'Estimate tunings per piano per year', 'tunings', 1, 'Once a year is typical.'),
        assume('perDay', 'How many pianos can a tuner do a day?', 'Estimate tunings per tuner per day', 'pianos', 4, 'About 2 hours each including travel.'),
        assume('days', 'How many days a year does a tuner work?', 'Estimate working days per year', 'days', 220, 'A normal working year.'),
        calc('total', 'So how many piano tuners?', 'Tunings needed ÷ tunings per tuner per year', 'tuners',
          (v) => (v.hh * pct(v.share) * v.tunings) / (v.perDay * v.days), (v) => `${n(v.hh)} × ${v.share}% × ${v.tunings} ÷ (${v.perDay} × ${v.days})`),
      ],
      sense: (v) => `That's one tuner per ${withCommas(Math.round(v.hh / v.total), 0)} households, a niche but real job. Plausible.`,
    }),
  },
  {
    id: 'sizing.bikes',
    name: 'Bikes sold per year',
    scope: 'country',
    build: (R) => {
      const own = R.id === 'nl' ? 90 : 40;
      return {
        question: `How many new bicycles are sold in ${R.name} each year?`,
        clarify: { questions: ['New bikes only?', "Including e-bikes and children's bikes?"], answer: "New bikes of all types, including e-bikes and children's bikes." },
        facts: facts(R),
        steps: [
          popStep(R),
          assume('own', 'What share of people own a bike?', 'Estimate bike ownership', '%', own,
            R.id === 'nl' ? 'The Netherlands has more bikes than people, so ~90% own at least one.' : 'Maybe 40%. It is much higher in the Netherlands and Denmark.'),
          assume('years', 'How often is a bike replaced, in years?', 'Estimate the replacement cycle', 'years', 8, "Adults keep bikes long; children's bikes are outgrown quickly. About 8 years on average."),
          calc('total', 'So how many bikes are sold a year?', 'Owners ÷ replacement cycle', 'bikes a year', (v) => (v.pop * pct(v.own)) / v.years, (v) => `${n(v.pop)} × ${v.own}% ÷ ${v.years}`),
        ],
        sense: (v) => `About 1 new bike per ${Math.round(v.pop / v.total)} people a year. Plausible.`,
      };
    },
  },
  {
    id: 'sizing.pizza',
    name: 'Pizzas sold per year',
    scope: 'both',
    build: (R) => {
      const perMonth = R.id === 'it' || R.id === 'rome' ? 2 : 1;
      return {
        question: `How many restaurant and takeaway pizzas are sold in ${R.name} each year?`,
        clarify: { questions: ['Restaurant and takeaway only, or frozen supermarket pizzas too?', 'Whole pizzas, or slices?'], answer: 'Restaurant and takeaway pizzas, counted as whole pizzas.' },
        facts: facts(R),
        steps: [
          popStep(R),
          assume('perMonth', 'How many restaurant or takeaway pizzas does a person eat a month?', 'Estimate pizzas per person per month', 'pizzas', perMonth,
            perMonth === 2 ? "In Italy it's more like twice a month." : 'About one a month across all ages.'),
          calc('total', 'So how many pizzas a year?', 'Population × pizzas a month × 12', 'pizzas a year', (v) => v.pop * v.perMonth * 12, (v) => `${n(v.pop)} × ${v.perMonth} × 12`),
        ],
        sense: (v) => `${fixed(v.total / v.pop, 0)} pizzas per person a year. Sounds right for a popular takeaway.`,
      };
    },
  },
  {
    id: 'sizing.xmastrees',
    name: 'Real Christmas trees',
    scope: 'country',
    build: (R) => ({
      question: `How many real Christmas trees are sold in ${R.name} each year?`,
      clarify: { questions: ['Real trees only, not artificial?', 'Homes only, or offices and public spaces too?'], answer: 'Real trees bought by households.' },
      facts: facts(R),
      steps: [
        ...householdSteps(R),
        assume('share', 'What share of households buy a real tree?', 'Estimate the share buying a real tree', '%', 30,
          'Many have artificial trees or none at all: maybe 30%.'),
        calc('total', 'So how many real trees a year?', 'Households × share', 'trees a year', (v) => v.hh * pct(v.share), (v) => `${n(v.hh)} × ${v.share}%`),
      ],
      sense: (v) => `About 1 real tree for every ${fixed(v.hh / v.total, 1)} households. Plausible.`,
    }),
  },
];

export const SIZING_BY_ID = Object.fromEntries(SIZING_TEMPLATES.map((t) => [t.id, t]));

function regionsFor(scope) {
  if (scope === 'city') return CITIES;
  if (scope === 'country') return COUNTRIES;
  return [...COUNTRIES, ...CITIES];
}

// Every (case, region) pair
export const SIZING_COMBOS = SIZING_TEMPLATES.flatMap((t) =>
  regionsFor(t.scope).map((R) => ({ template: t, region: R, fingerprint: `${t.id}|${R.id}` }))
);

// Run the whole chain with given inputs (yours or mine). Calculation stages
// are computed from the inputs, so your maths is judged on your own numbers.
export function evaluate(steps, inputs) {
  const v = {};
  for (const s of steps) v[s.key] = s.kind === 'calc' ? s.f(v) : inputs[s.key];
  return v;
}

export function referenceValues(steps) {
  const inputs = {};
  for (const s of steps) if (s.kind !== 'calc') inputs[s.key] = s.value;
  return evaluate(steps, inputs);
}

export function makeCase({ template: t, region: R, fingerprint }) {
  const built = t.build(R);
  const ref = referenceValues(built.steps);
  const last = built.steps[built.steps.length - 1];
  return { templateId: t.id, name: t.name, region: R, fingerprint, ...built, ref, answer: ref[last.key], finalStep: last };
}

// Value display for a stage: 30%, €35, 2.6M
export function fmtStage(step, value, cur) {
  if (value == null || !Number.isFinite(value)) return '–';
  if (step.unit === '%') return `${withCommas(roundSig(value, 3), 2)}%`;
  const num = Math.abs(value) >= 1000 ? fmtNum(roundSig(value, 2)) : withCommas(roundSig(value, 3), 2);
  return step.money ? `${cur}${num}` : num;
}

// Picks the case you've seen least recently (never-seen first) and never
// the same case type twice in a row.
export class SizingPicker {
  constructor({ rng = createRng(), recentFingerprints = [] } = {}) {
    this.rng = rng;
    this.lastSeen = new Map();
    recentFingerprints.forEach((fp, i) => this.lastSeen.set(fp, i));
    this.tick = recentFingerprints.length;
    this.lastTemplate = null;
  }

  next() {
    let pool = SIZING_COMBOS.filter((c) => c.template.id !== this.lastTemplate);
    const seen = (c) => this.lastSeen.get(c.fingerprint) ?? -1;
    const oldest = Math.min(...pool.map(seen));
    pool = pool.filter((c) => seen(c) === oldest);
    const combo = this.rng.pick(pool);
    this.lastSeen.set(combo.fingerprint, this.tick++);
    this.lastTemplate = combo.template.id;
    return makeCase(combo);
  }
}
