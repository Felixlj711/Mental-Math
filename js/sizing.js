// Market sizing, structure first. A full case runs like an interview:
//   1. clarify   2. choose the angle   3. build the tree   4. tap a range
//   for each number   5. one calculation   6. sense-check a colleague's answer
// It is scored mostly on structure and judgement; the final number only has
// to be within 3× of mine.
//
// Every tree is a chain: the first driver, then × or ÷ each of the others.
// The answer, the formula text and the wrong approaches are all built from it.

import { fmtNum, roundSig, withCommas } from './format.js';
import { createRng } from './rng.js';

export const CALC_TOLERANCE = 0.1; // your maths, using your own numbers
export const BALLPARK = 3; // final answer: within 3× of mine
export const CASE_POINTS = ['angle', 'tree', 'maths', 'sense', 'ballpark'];

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
const n = (x) => fmtNum(roundSig(x, 3));
const fixed = (x, d) => String(Number(x.toFixed(d)));
const whole = (x) => withCommas(Math.round(x), 0);

// Ranges you tap instead of typing a number: [low, high, value used if mine isn't in it].
const PCT_BANDS = [[0, 10, 5], [10, 30, 20], [30, 60, 45], [60, 100, 80]];
const DAY_BANDS = [[50, 150, 100], [150, 200, 180], [200, 300, 240], [300, 365, 340]];
const SIZE_BANDS = [[1, 2, 1.5], [2, 3, 2.3], [3, 4, 3.5], [4, 6, 5]];
const LIFE_BANDS = [[50, 65, 60], [65, 75, 70], [75, 85, 80], [85, 100, 90]];

// Tree drivers. op is how a driver joins the chain ('' for the first one).
const driver = (kind) => (key, op, block, ask, unit, value, note, extra = {}) => ({ key, kind, op, block, ask, unit, value, note, ...extra });
const fact = driver('fact'); // something you should know: right if your range holds mine
const assume = driver('assume'); // judgement: never wrong, you just see mine
const konst = (key, op, block, value, note) => ({ key, kind: 'const', op, block, unit: '', value, note });
// Blocks that don't belong in the tree.
const off = (key, block, why) => ({ key, kind: 'off', block, why });
const trap = (key, block, why) => ({ key, kind: 'trap', block, why }); // double counts
const unit = (key, block, why) => ({ key, kind: 'unit', block, why }); // wrong time unit

export const EXTRA_LABELS = { off: "Doesn't belong", trap: 'Double counts', unit: 'Wrong unit' };

// Angles: how you come at the question.
const angle = (label) => (ok, why, mine = false) => ({ label, ok, why, mine });
const D = angle('Demand side: people × how much they buy or use');
const S = angle('Supply side: outlets or capacity × throughput');
const P = angle('Proxy: scale up a known benchmark');

const popD = (R, op = '') =>
  fact('pop', op, 'Population', `What is the population of ${R.name}?`, 'people', R.pop, `${R.label} has about ${fmtNum(R.pop)} people.`);
const lifeD = () =>
  fact('life', '÷', 'Life expectancy (one age group)', 'What is life expectancy in Western Europe?', 'years', 80,
    'About 80 years, so each year of age is roughly population ÷ 80.', { bands: LIFE_BANDS });
const adultsD = () => assume('adults', '×', '% who are adults', 'What share of people are adults?', '%', 80, 'Roughly 80% are 18 or over.');
const months = () => konst('months', '×', '× 12 months', 12, 'Monthly to yearly.');

// Households: a known fact for countries, population ÷ household size for cities.
function homes(R) {
  if (!R.city) {
    return [fact('hh', '', 'Households', `How many households are there in ${R.name}?`, 'households', R.hh,
      `${R.label} has about ${fmtNum(R.hh)} households (≈ ${fixed(R.pop / R.hh, 1)} people each).`)];
  }
  return [
    popD(R),
    assume('size', '÷', 'People per household', 'How many people live in an average household?', 'people', 2.3,
      'About 2.3 across Europe, a bit lower in big cities.', { bands: SIZE_BANDS }),
  ];
}
const homesOf = (R) => (R.city ? R.pop / 2.3 : R.hh);
const homesTrap = (R) =>
  R.city
    ? trap('adults', '% who are adults', 'This is bought per household. Filtering people to adults as well counts the same people twice.')
    : trap('pop', 'Population', 'This is bought per household. Starting from households and population counts the same people twice.');
const peopleTrap = (what) => trap('hh', 'Number of households', `${what} per person. Using households as well counts the same people twice.`);
const price = (what) => off('price', `Price of ${what}`, 'The question asks for a count, not money.');

const facts = (R, extra = []) => [
  `${R.label} population ≈ ${fmtNum(R.pop)}`,
  ...(R.city ? [] : [`${R.label} households ≈ ${fmtNum(R.hh)}`]),
  ...extra,
];
const LIFE = 'Life expectancy ≈ 80 years';
const CARS = 'About 1 car for every 2 people';

// Main airport per city, for the flights case.
const AIRPORTS = {
  london: { name: 'London Heathrow', runways: 2, rate: 45, note: "Heathrow's two runways are among the busiest in the world: a plane every ~80 seconds." },
  paris: { name: 'Paris Charles de Gaulle', runways: 4, rate: 22, note: 'With four runways, each one is used less intensively than at Heathrow.' },
  amsterdam: { name: 'Amsterdam Schiphol', runways: 3, rate: 28, note: 'Schiphol has six runways but usually only about three in use at once.' },
  madrid: { name: 'Madrid Barajas', runways: 4, rate: 18, note: 'Four runways, used well below their limit for most of the day.' },
};

// ---------- cases ----------
// scope: 'city', 'country', 'both' or a list of region ids. build(R) returns the case.
// archetype: what kind of logic the case uses, so different shapes come up.
export const SIZING_TEMPLATES = [
  {
    id: 'sizing.coffee',
    name: 'Café coffees per day',
    archetype: 'People × usage',
    scope: 'city',
    build: (R) => ({
      question: `How many cups of coffee are bought in cafés in ${R.name} on a typical day?`,
      clarify: {
        questions: ['Only cafés and coffee shops, or also offices, vending machines and supermarkets?', 'Residents only, or commuters and tourists too?', 'Any coffee drink, or only black coffee?'],
        answer: 'Cafés and coffee shops only, bought by residents, and any coffee drink counts.',
      },
      facts: facts(R, ['Adults ≈ 80% of the population']),
      angles: [
        D(true, 'Residents × share buying a coffee × cups: easy numbers to reason about.', true),
        S(true, 'Cafés × cups each sells a day also works, if you can estimate how many cafés there are.'),
        P(true, "If you know a chain's store count and sales per store, you can scale up from its share."),
      ],
      tree: [
        popD(R),
        adultsD(),
        assume('buy', '×', '% of adults buying a café coffee that day', 'What share of adults buy a café coffee on a given day?', '%', 30,
          'Maybe 1 in 3: plenty of commuters do, but many people make coffee at home.'),
        assume('cups', '×', 'Cups per buyer', 'How many cups does each of them buy that day?', 'cups', 1.2, 'Most have one, some have two.'),
      ],
      extras: [
        peopleTrap('Coffee is bought'),
        off('cafes', 'Number of cafés', "That's the supply side. Mixing it into a demand tree counts the market twice."),
        price('a coffee'),
        off('tourists', 'Tourists per day', 'The interviewer said residents only.'),
        unit('days', '× 365 days', 'The question is per day, so no need to scale up to a year.'),
      ],
      unit: 'café coffees a day',
      per: (x) => `${fixed(x / R.pop, 2)} café coffees per resident a day`,
    }),
  },
  {
    id: 'sizing.commute',
    name: 'Public transport commutes',
    archetype: 'People × usage',
    scope: 'city',
    build: (R) => ({
      question: `How many commuting trips are made on public transport in ${R.name} on a weekday?`,
      clarify: {
        questions: ['Commuting to work only, or also school and shopping trips?', 'Does a return journey count as one trip or two?', 'Bus, metro, tram and rail all count?'],
        answer: 'Trips to and from work only; each one-way journey is one trip; all public transport counts.',
      },
      facts: facts(R),
      angles: [
        D(true, 'Workers × share using public transport × trips each.', true),
        S(true, 'Vehicles × trips × passengers each works, but those numbers are harder to guess.'),
        P(true, "If you know the metro's daily ridership, you can take the commuting share of it."),
      ],
      tree: [
        popD(R),
        assume('work', '×', '% in work', 'What share of residents are in work?', '%', 50, 'About half: the rest are children, students, retirees and people not working.'),
        assume('pt', '×', '% of workers using public transport', 'What share of workers commute by public transport?', '%', 40,
          'Big European cities have strong transit, so maybe 40%. Less in car-heavy cities, more in central London or Paris.'),
        konst('trips', '×', '× 2 trips a day', 2, 'There and back.'),
      ],
      extras: [
        peopleTrap('Commuters are counted'),
        off('stations', 'Number of stations', "Supply side: it doesn't tell you how many people ride."),
        unit('days', '× 250 working days', 'The question asks about one weekday.'),
        off('cars', 'Car ownership', 'The share using public transport already covers how people get to work.'),
      ],
      unit: 'trips a day',
      per: (x) => `${fixed(x / R.pop, 2)} commuting trips per resident a weekday`,
    }),
  },
  {
    id: 'sizing.hairdressers',
    name: 'Number of hairdressers',
    archetype: 'Demand ÷ capacity',
    scope: 'both',
    build: (R) => ({
      question: `Roughly how many hairdressers and barbers work in ${R.name}?`,
      clarify: {
        questions: ['Hairdressers and barbers both?', 'People who cut hair, or the number of salons?', 'Full-time equivalents, or everyone including part-timers?'],
        answer: 'Count people (hairdressers and barbers), as full-time equivalents.',
      },
      facts: facts(R),
      angles: [
        D(true, 'Haircuts needed ÷ haircuts one hairdresser can do a year.', true),
        S(true, 'Salons × staff per salon works if you have a feel for how many salons there are.'),
        P(false, "There's no well-known benchmark to scale from, so build it up."),
      ],
      tree: [
        popD(R),
        assume('cuts', '×', 'Haircuts per person a year', 'How many haircuts does a person get a year?', 'haircuts', 6,
          'Men every 6–8 weeks, women less often but with longer appointments, children fewer: about 6 on average.'),
        assume('perDay', '÷', 'Cuts per hairdresser a day', 'How many cuts does a hairdresser do a day?', 'cuts', 8, 'About one an hour over a working day.'),
        assume('days', '÷', 'Working days a year', 'How many days a year do they work?', 'days', 250, 'Five days a week, minus holidays.', { bands: DAY_BANDS }),
      ],
      extras: [
        peopleTrap('Haircuts are counted'),
        off('price', 'Price of a haircut', 'We want people, not revenue.'),
        off('salons', 'Number of salons', "That's for a supply-side tree; it doesn't fit demand ÷ capacity."),
        unit('weeks', '× 52 weeks', 'Haircuts and working days are both already per year.'),
      ],
      unit: 'hairdressers',
      per: (x) => `one hairdresser for every ${whole(R.pop / x)} people`,
    }),
  },
  {
    id: 'sizing.dentists',
    name: 'Number of dentists',
    archetype: 'Demand ÷ capacity',
    scope: 'country',
    build: (R) => ({
      question: `Roughly how many dentists are there in ${R.name}?`,
      clarify: {
        questions: ['Practising dentists only, or also hygienists and assistants?', 'Public and private practices?'],
        answer: 'Practising dentists, in both public and private practice.',
      },
      facts: facts(R),
      angles: [
        D(true, 'Dental visits a year ÷ visits one dentist can handle.', true),
        S(true, 'Practices × dentists per practice works if you know how dense practices are.'),
        P(false, 'You might know doctors per person, but dentists differ too much to scale from that.'),
      ],
      tree: [
        popD(R),
        assume('visits', '×', 'Dental visits per person a year', 'How many dental visits does a person make a year?', 'visits', 2,
          'Check-ups are recommended twice a year. Some go less, others need treatment visits, so 2 is a fair average.'),
        assume('perDay', '÷', 'Patients per dentist a day', 'How many patients does a dentist see a day?', 'patients', 15, 'About 2 an hour over 7–8 hours.'),
        assume('days', '÷', 'Working days a year', 'How many days a year does a dentist work?', 'days', 220, 'Four to five days a week, minus holidays.', { bands: DAY_BANDS }),
      ],
      extras: [
        peopleTrap('Visits are counted'),
        off('hyg', 'Number of hygienists', 'The interviewer only wants dentists.'),
        off('price', 'Cost of a check-up', 'We want a count of dentists, not spend.'),
        unit('hours', '× 8 hours a day', 'Patients a day already covers the whole working day.'),
      ],
      unit: 'dentists',
      per: (x) => `one dentist for every ${whole(R.pop / x)} people`,
    }),
  },
  {
    id: 'sizing.smartphones',
    name: 'Smartphones sold per year',
    archetype: 'Stock ÷ lifetime',
    scope: 'country',
    build: (R) => ({
      question: `How many smartphones are sold in ${R.name} each year?`,
      clarify: { questions: ['New phones only, or second-hand too?', 'Consumer phones only, or business phones too?'], answer: 'New phones, for consumers and businesses.' },
      facts: facts(R),
      angles: [
        D(true, 'Phones in use ÷ how often they are replaced.', true),
        S(false, 'Shops × phones per shop is hard: many phones are bought online or from carriers.'),
        P(true, "If you know a big brand's unit sales and market share, you can scale up."),
      ],
      tree: [
        popD(R),
        assume('own', '×', '% who own a smartphone', 'What share of people own a smartphone?', '%', 85, 'Almost every adult and teenager, fewer young children and elderly: about 85%.'),
        assume('years', '÷', 'Years before replacing', 'How often is a phone replaced, in years?', 'years', 3, 'Most people upgrade every 2–4 years.'),
      ],
      extras: [
        peopleTrap('Phones are counted'),
        price('a phone'),
        unit('months', '× 12 months', 'The replacement cycle is already in years.'),
        off('brands', 'Number of brands', "Doesn't change how many phones are bought."),
      ],
      unit: 'phones a year',
      per: (x) => `${fixed(x / R.pop, 2)} new phones per person a year`,
    }),
  },
  {
    id: 'sizing.washing',
    name: 'Washing machines sold per year',
    archetype: 'Stock ÷ lifetime',
    scope: 'country',
    build: (R) => ({
      question: `How many washing machines are sold in ${R.name} each year?`,
      clarify: { questions: ['Household machines only, or also laundrettes and hotels?', 'Replacements and first-time buyers?'], answer: 'Household machines, all purchases.' },
      facts: facts(R),
      angles: [
        D(true, 'Machines in homes ÷ how long a machine lasts.', true),
        S(false, 'Appliance shops × sales per shop is much harder to estimate.'),
        P(false, "There's no common benchmark to scale from."),
      ],
      tree: [
        ...homes(R),
        assume('own', '×', '% of households with a machine', 'What share of households own a washing machine?', '%', 95, 'Nearly all; a few rely on shared or communal machines.'),
        assume('life', '÷', 'Years a machine lasts', 'How many years does a machine last?', 'years', 10, 'Roughly 8–12 years.'),
      ],
      extras: [
        homesTrap(R),
        price('a machine'),
        off('loads', 'Loads per week', 'How much it is used is already built into its lifetime.'),
        off('shops', 'Number of appliance shops', "Supply side: doesn't fit this tree."),
      ],
      unit: 'machines a year',
      per: (x) => `one new machine per ${fixed(R.hh / x, 1)} households a year`,
    }),
  },
  {
    id: 'sizing.nappies',
    name: 'Nappies used per year',
    archetype: 'Age group × usage',
    scope: 'country',
    build: (R) => ({
      question: `How many disposable nappies (diapers) are used in ${R.name} each year?`,
      clarify: { questions: ['Disposable only, or reusable cloth nappies too?', 'Baby nappies only, or adult products too?'], answer: 'Disposable baby nappies only.' },
      facts: facts(R, [LIFE]),
      angles: [
        D(true, 'Babies in nappies × nappies a day × 365.', true),
        S(false, 'Shops or factories are far harder to estimate.'),
        P(false, "There's no common benchmark to scale from."),
      ],
      tree: [
        popD(R),
        lifeD(),
        assume('years', '×', 'Years in nappies', 'How many years does a child wear nappies?', 'years', 2.5, 'Most are potty-trained between 2 and 3.'),
        assume('perDay', '×', 'Nappies a day', 'How many nappies a day on average?', 'nappies', 5, 'More for newborns (8+), fewer for toddlers (3–4).'),
        konst('days', '×', '× 365 days', 365, 'Daily to yearly.'),
      ],
      extras: [
        trap('parents', 'Number of parents', 'Babies are already counted; adding parents counts each baby again.'),
        off('price', 'Price of a nappy', 'The question asks for a count, not money.'),
        unit('weeks', '× 52 weeks', '× 365 already turns a day into a year.'),
        off('hh', 'Number of households', 'Nappies follow babies, not households.'),
      ],
      unit: 'nappies a year',
      per: (x) => `${whole(x / ((R.pop / 80) * 2.5))} nappies per child in nappies a year`,
    }),
  },
  {
    id: 'sizing.weddings',
    name: 'Weddings per year',
    archetype: 'Age group × share',
    scope: 'country',
    build: (R) => ({
      question: `How many weddings take place in ${R.name} each year?`,
      clarify: { questions: ['Weddings of residents, or weddings held in the country (destination weddings)?', 'Civil ceremonies and partnerships too?'], answer: 'All weddings of residents, including civil ceremonies.' },
      facts: facts(R, [LIFE]),
      angles: [
        D(true, 'One age group × share who marry ÷ 2 people per wedding.', true),
        S(false, 'Venues × weddings per venue is hard to estimate.'),
        P(false, "You'd need to know a marriage rate already."),
      ],
      tree: [
        popD(R),
        lifeD(),
        assume('marry', '×', '% who marry at some point', 'What share of people marry at some point?', '%', 50, 'Roughly half; remarriages roughly offset those who never marry.'),
        konst('couple', '÷', '÷ 2 people per wedding', 2, 'Each wedding marries two people.'),
      ],
      extras: [
        trap('both', '× 2 (bride and groom)', 'Each wedding is two people, so divide by 2. Multiplying counts every wedding four times over.'),
        off('guests', 'Guests per wedding', "Doesn't change how many weddings happen."),
        off('venues', 'Number of venues', "Supply side: doesn't fit this tree."),
        off('hh', 'Number of households', 'People marry, not households.'),
      ],
      unit: 'weddings a year',
      per: (x) => `${fixed((x / R.pop) * 1000, 1)} weddings per 1,000 people a year`,
    }),
  },
  {
    id: 'sizing.cinema',
    name: 'Cinema box office',
    archetype: 'People × usage × price',
    scope: 'both',
    build: (R) => ({
      question: `What is the annual cinema box office in ${R.name}, in ${R.cur}?`,
      clarify: { questions: ['Ticket sales only, or snacks and drinks too?', 'Residents only, or everyone buying a ticket there?'], answer: 'Ticket revenue only, from everyone buying a ticket.' },
      facts: facts(R),
      angles: [
        D(true, 'People × visits a year × ticket price.', true),
        S(true, 'Screens × shows a day × seats × occupancy × price works too.'),
        P(false, "There's no simple benchmark to scale from."),
      ],
      tree: [
        popD(R),
        assume('visits', '×', 'Cinema visits per person a year', 'How many times does a person go to the cinema a year?', 'visits', 2, 'Some go monthly, many never: about 2 on average.'),
        assume('price', '×', 'Average ticket price', `What is the average ticket price, in ${R.cur}?`, R.cur, 9, 'Around 8–12 in big cities, less with discounts and matinees.', { money: true }),
      ],
      extras: [
        peopleTrap('Tickets are counted'),
        off('screens', 'Number of screens', "Supply side: doesn't fit this tree."),
        off('snacks', 'Snack spend per visit', 'The interviewer said tickets only.'),
        unit('months', '× 12 months', 'Visits are already per year.'),
      ],
      unit: 'a year',
      money: true,
      per: (x) => `${R.cur}${fixed(x / R.pop, 1)} per person a year on cinema tickets`,
    }),
  },
  {
    id: 'sizing.gyms',
    name: 'Gym membership market',
    archetype: 'People × usage × price',
    scope: 'country',
    build: (R) => ({
      question: `How much is the gym membership market in ${R.name} worth per year, in ${R.cur}?`,
      clarify: { questions: ['Membership fees only, or also personal training and classes?', 'Budget gyms and premium clubs both?'], answer: 'Membership fees only, for all types of gym.' },
      facts: facts(R, ['Adults ≈ 80% of the population']),
      angles: [
        D(true, 'Adults × share with a membership × fee × 12.', true),
        S(true, 'Gyms × members per gym × fee works if you know how many gyms there are.'),
        P(true, "If you know a big chain's members and market share, scale up."),
      ],
      tree: [
        popD(R),
        adultsD(),
        assume('members', '×', '% of adults with a membership', 'What share of adults have a gym membership?', '%', 15, 'Around 1 in 7 adults in Western Europe.'),
        assume('fee', '×', 'Monthly fee', `What is an average monthly fee, in ${R.cur}?`, R.cur, 35, 'Budget gyms ~20–25, premium clubs 60+: about 35 on average.', { money: true }),
        months(),
      ],
      extras: [
        peopleTrap('Memberships are counted'),
        off('gyms', 'Number of gyms', "Supply side: doesn't fit this tree."),
        off('pt', 'Personal training spend', 'We agreed membership fees only.'),
        unit('weeks', '× 52 weeks', 'The fee is monthly, so × 12, not × 52.'),
      ],
      unit: 'a year',
      money: true,
      per: (x) => `${R.cur}${whole(x / R.pop)} per person a year on gym memberships`,
    }),
  },
  {
    id: 'sizing.streaming',
    name: 'Video streaming market',
    archetype: 'Households × usage × price',
    scope: 'country',
    build: (R) => ({
      question: `How much do households in ${R.name} spend on video streaming subscriptions per year, in ${R.cur}?`,
      clarify: { questions: ['Video only (Netflix, Disney+ …), or music too?', 'Paid subscriptions only, or also free, ad-supported services?'], answer: 'Paid video subscriptions only.' },
      facts: facts(R),
      angles: [
        D(true, 'Households × share subscribing × services × price × 12.', true),
        S(false, 'Adding up each service needs subscriber numbers you are unlikely to know.'),
        P(true, "If you know Netflix's subscribers and its share of spend, scale up."),
      ],
      tree: [
        ...homes(R),
        assume('share', '×', '% of households subscribing', 'What share of households pay for video streaming?', '%', 60, 'Most households, but not older or price-sensitive ones: about 60%.'),
        assume('services', '×', 'Services per subscribing household', 'How many services does a subscribing household have?', 'services', 1.5, 'Often one big service plus a second now and then.'),
        assume('price', '×', 'Monthly price per service', `What does one service cost a month, in ${R.cur}?`, R.cur, 10, 'About 6–15 depending on the plan.', { money: true }),
        months(),
      ],
      extras: [
        homesTrap(R),
        off('music', 'Music subscriptions', 'Video only.'),
        unit('days', '× 365 days', 'The price is monthly; × 12 makes it yearly.'),
        off('hours', 'Hours watched', "Doesn't change what they pay."),
      ],
      unit: 'a year',
      money: true,
      per: (x) => `${R.cur}${fixed(x / homesOf(R) / 12, 1)} per household a month`,
    }),
  },
  {
    id: 'sizing.petfood',
    name: 'Pet food market',
    archetype: 'Households × usage × price',
    scope: 'country',
    build: (R) => ({
      question: `How big is the cat and dog food market in ${R.name} per year, in ${R.cur}?`,
      clarify: { questions: ['Cats and dogs only, or all pets?', 'Food and treats only, or accessories and vet bills too?'], answer: 'Cat and dog food and treats only.' },
      facts: facts(R),
      angles: [
        D(true, 'Pet households × monthly food spend × 12.', true),
        S(false, 'Pet shops and supermarkets both sell pet food, so outlets are hard to count.'),
        P(false, "There's no common benchmark to scale from."),
      ],
      tree: [
        ...homes(R),
        assume('share', '×', '% of households with a cat or dog', 'What share of households have a cat or dog?', '%', 45, 'Roughly 40–50% in most of Western Europe.'),
        assume('spend', '×', 'Monthly food spend per pet household', `How much does a pet household spend on food a month, in ${R.cur}?`, R.cur, 30,
          'A cat costs less, a big dog more: about 30 on average.', { money: true }),
        months(),
      ],
      extras: [
        homesTrap(R),
        trap('pets', 'Pets per household', 'The spend is already per pet household, so this counts extra pets twice.'),
        off('vets', 'Vet bills', 'Food only.'),
        unit('weeks', '× 52 weeks', 'The spend is monthly, so × 12.'),
      ],
      unit: 'a year',
      money: true,
      per: (x) => `${R.cur}${whole(x / homesOf(R))} per household a year on pet food`,
    }),
  },
  {
    id: 'sizing.teachers',
    name: 'School teachers',
    archetype: 'Age group ÷ ratio',
    scope: 'country',
    build: (R) => ({
      question: `Roughly how many school teachers are there in ${R.name}?`,
      clarify: { questions: ['Primary and secondary only, or universities too?', 'Full-time equivalents, or everyone who teaches?'], answer: 'Primary and secondary schools, as full-time equivalent teachers.' },
      facts: facts(R, [LIFE]),
      angles: [
        D(true, 'Pupils ÷ pupils per teacher.', true),
        S(true, 'Schools × teachers per school works if you know how many schools there are.'),
        P(false, "There's no common benchmark to scale from."),
      ],
      tree: [
        popD(R),
        lifeD(),
        assume('years', '×', 'Years at school', 'How many years does a child spend at school?', 'years', 13, 'Roughly ages 5 to 17.'),
        assume('ratio', '÷', 'Pupils per teacher', 'How many pupils are there per teacher?', 'pupils', 18, 'Classes are 25–30, but teachers also plan and specialise: about 18 per teacher overall.'),
      ],
      extras: [
        trap('class', 'Class size', 'You already divide by pupils per teacher; dividing by class size too counts the same thing twice.'),
        off('schools', 'Number of schools', "You'd also need teachers per school; doesn't fit this tree."),
        off('uni', 'University students', 'Primary and secondary only.'),
        off('salary', 'Teacher salary', 'We want a count, not money.'),
      ],
      unit: 'teachers',
      per: (x) => `one teacher for every ${whole(R.pop / x)} people`,
    }),
  },
  {
    id: 'sizing.petrol',
    name: 'Petrol stations',
    archetype: 'Demand ÷ capacity',
    scope: 'country',
    build: (R) => ({
      question: `Roughly how many petrol stations are there in ${R.name}?`,
      clarify: { questions: ['Public stations only, or also private fleet depots?', 'Do EV charging sites count?'], answer: 'Public petrol stations only.' },
      facts: facts(R, [CARS]),
      angles: [
        D(true, 'Fill-ups needed a day ÷ what one station handles.', true),
        S(false, "Counting stations directly is the question itself, so there's nothing to build on."),
        P(true, 'Stations per motorway junction or per town can be scaled up if you know them.'),
      ],
      tree: [
        popD(R),
        assume('perCar', '÷', 'People per car', 'How many people are there per car?', 'people', 2, 'About one car for every two people in Western Europe.'),
        assume('fills', '×', 'Fill-ups per car a year', 'How many times a year is a car filled up?', 'fill-ups', 50, 'About once a week.'),
        konst('days', '÷', '÷ 365 days', 365, 'Yearly to daily.'),
        assume('capacity', '÷', 'Fill-ups per station a day', 'How many fill-ups does a station handle a day?', 'fill-ups', 600, 'Say 8 pumps × ~75 cars a day each.'),
      ],
      extras: [
        peopleTrap('Cars are worked out'),
        off('ev', 'EV chargers', 'Public petrol stations only.'),
        off('litres', 'Litres per fill-up', "Only needed if you size fuel volume; doesn't change the number of fill-ups."),
        unit('weeks', '× 52 weeks', 'Fill-ups are already per year.'),
      ],
      unit: 'stations',
      per: (x) => `${whole(R.pop / 2 / x)} cars per station`,
    }),
  },
  {
    id: 'sizing.piano',
    name: 'Piano tuners',
    archetype: 'Demand ÷ capacity',
    scope: 'both',
    build: (R) => ({
      question: `Roughly how many piano tuners work in ${R.name}?`,
      clarify: { questions: ['Only people who tune pianos for a living?', 'Pianos in homes only, or schools, churches and concert halls too?'], answer: 'Full-time tuners; homes are the main market, so start there.' },
      facts: facts(R),
      angles: [
        D(true, 'Tunings needed a year ÷ tunings one tuner can do.', true),
        S(false, 'Tuners are hard to spot directly, which is why this is a classic.'),
        P(false, "There's no common benchmark to scale from."),
      ],
      tree: [
        ...homes(R),
        assume('share', '×', '% of households with a piano', 'What share of households own a piano?', '%', 3, 'Maybe 1 in 30 homes.'),
        assume('tunings', '×', 'Tunings per piano a year', 'How many tunings does a piano get a year?', 'tunings', 1, 'Once a year is typical.',
          { bands: [[0.2, 0.5, 0.3], [0.5, 1, 0.7], [1, 2, 1.5], [2, 4, 3]] }),
        assume('perDay', '÷', 'Pianos a tuner does a day', 'How many pianos can a tuner do a day?', 'pianos', 4, 'About 2 hours each including travel.'),
        assume('days', '÷', 'Working days a year', 'How many days a year does a tuner work?', 'days', 220, 'A normal working year.', { bands: DAY_BANDS }),
      ],
      extras: [
        homesTrap(R),
        off('price', 'Price of a tuning', 'We want people, not money.'),
        off('schools', 'Pianos in schools and concert halls', 'The interviewer said start with homes.'),
        unit('hours', '× 8 hours a day', 'Pianos a day already covers the working day.'),
      ],
      unit: 'tuners',
      per: (x) => `one tuner for every ${whole(homesOf(R) / x)} households`,
    }),
  },
  {
    id: 'sizing.bikes',
    name: 'Bikes sold per year',
    archetype: 'Stock ÷ lifetime',
    scope: 'country',
    build: (R) => {
      const own = R.id === 'nl' ? 90 : 40;
      return {
        question: `How many new bicycles are sold in ${R.name} each year?`,
        clarify: { questions: ['New bikes only?', "Including e-bikes and children's bikes?"], answer: "New bikes of all types, including e-bikes and children's bikes." },
        facts: facts(R),
        angles: [
          D(true, 'Bikes owned ÷ how often they are replaced.', true),
          S(false, 'Bike shops × sales per shop misses online and supermarket sales.'),
          P(false, "There's no common benchmark to scale from."),
        ],
        tree: [
          popD(R),
          assume('own', '×', '% who own a bike', 'What share of people own a bike?', '%', own,
            R.id === 'nl' ? 'The Netherlands has more bikes than people, so ~90% own at least one.' : 'Maybe 40%. It is much higher in the Netherlands and Denmark.'),
          assume('years', '÷', 'Years before replacing', 'How often is a bike replaced, in years?', 'years', 8,
            "Adults keep bikes long; children's bikes are outgrown quickly. About 8 years on average."),
        ],
        extras: [
          peopleTrap('Bikes are counted'),
          price('a bike'),
          off('shops', 'Number of bike shops', "Supply side: doesn't fit this tree."),
          unit('months', '× 12 months', 'The replacement cycle is in years.'),
        ],
        unit: 'bikes a year',
        per: (x) => `one new bike for every ${fixed(R.pop / x, 1)} people a year`,
      };
    },
  },
  {
    id: 'sizing.pizza',
    name: 'Pizzas sold per year',
    archetype: 'People × usage',
    scope: 'both',
    build: (R) => {
      const perMonth = R.id === 'it' || R.id === 'rome' ? 2 : 1;
      return {
        question: `How many restaurant and takeaway pizzas are sold in ${R.name} each year?`,
        clarify: { questions: ['Restaurant and takeaway only, or frozen supermarket pizzas too?', 'Whole pizzas, or slices?'], answer: 'Restaurant and takeaway pizzas, counted as whole pizzas.' },
        facts: facts(R),
        angles: [
          D(true, 'People × pizzas a month × 12.', true),
          S(true, 'Pizzerias × pizzas each sells a day × 365 works if you can count pizzerias.'),
          P(true, "If you know a delivery chain's sales and share, scale up."),
        ],
        tree: [
          popD(R),
          assume('perMonth', '×', 'Pizzas per person a month', 'How many restaurant or takeaway pizzas does a person eat a month?', 'pizzas', perMonth,
            perMonth === 2 ? "In Italy it's more like twice a month." : 'About one a month across all ages.',
            { bands: [[0.2, 0.5, 0.3], [0.5, 1, 0.7], [1, 3, 2], [3, 6, 4]] }),
          months(),
        ],
        extras: [
          peopleTrap('Pizzas are counted'),
          off('pizzerias', 'Number of pizzerias', "Supply side: doesn't fit this tree."),
          off('frozen', 'Frozen pizzas', 'Restaurant and takeaway only.'),
          unit('weeks', '× 52 weeks', 'The rate is per month, so × 12.'),
        ],
        unit: 'pizzas a year',
        per: (x) => `${fixed(x / R.pop, 1)} pizzas per person a year`,
      };
    },
  },
  {
    id: 'sizing.xmastrees',
    name: 'Real Christmas trees',
    archetype: 'Households × share',
    scope: 'country',
    build: (R) => ({
      question: `How many real Christmas trees are sold in ${R.name} each year?`,
      clarify: { questions: ['Real trees only, not artificial?', 'Homes only, or offices and public spaces too?'], answer: 'Real trees bought by households.' },
      facts: facts(R),
      angles: [
        D(true, 'Households × share buying a real tree.', true),
        S(false, 'Tree farms and sellers are seasonal and hard to count.'),
        P(false, "There's no common benchmark to scale from."),
      ],
      tree: [
        ...homes(R),
        assume('share', '×', '% of households buying a real tree', 'What share of households buy a real tree?', '%', 30, 'Many have artificial trees or none at all: maybe 30%.'),
      ],
      extras: [
        homesTrap(R),
        price('a tree'),
        unit('months', '× 12 months', 'A tree is bought once a year.'),
        off('artificial', 'Artificial trees sold', 'Real trees only.'),
      ],
      unit: 'trees a year',
      per: (x) => `one real tree for every ${fixed(R.hh / x, 1)} households`,
    }),
  },

  // ----- new shapes -----
  {
    id: 'sizing.flights',
    name: 'Flights per day at an airport',
    archetype: 'Supply capacity',
    scope: Object.keys(AIRPORTS),
    build: (R) => {
      const A = AIRPORTS[R.id];
      return {
        question: `How many flights take off or land at ${A.name} on a typical day?`,
        clarify: {
          questions: ['Do take-offs and landings both count?', 'Passenger flights only, or cargo too?', 'A typical day, or the busiest day of summer?'],
          answer: 'Every take-off and every landing is one flight. All types count, on a typical day.',
        },
        facts: [`${A.name}: ${A.runways} runways in use`, 'Most big European airports close or slow down at night'],
        angles: [
          S(true, 'At a busy hub the runways are the bottleneck, so capacity gives a tight answer.', true),
          D(true, 'Passengers a year ÷ passengers per flight ÷ 365 also works if you know the passenger number.'),
          P(false, "You'd need a comparable airport's figure already."),
        ],
        tree: [
          fact('runways', '', 'Runways in use', `How many runways does ${A.name} use at once?`, 'runways', A.runways, `${A.name} uses ${A.runways} at a time.`,
            { bands: [[1, 1, 1], [2, 2, 2], [3, 4, 3.5], [5, 8, 6]] }),
          assume('rate', '×', 'Flights per runway an hour', 'How many flights can one runway handle an hour?', 'flights', A.rate, A.note),
          assume('hours', '×', 'Hours open a day', 'How many hours a day does the airport run flights?', 'hours', 17, 'Roughly 6am to 11pm, with a night curfew.',
            { bands: [[6, 10, 8], [10, 15, 12], [15, 20, 17], [20, 24, 24]] }),
          assume('busy', '×', '% of capacity used', 'Across the day, how busy are the runways on average?', '%', 85, 'Hubs run near capacity at peaks and a bit below in between.'),
        ],
        extras: [
          trap('both', '× 2 (take-off and landing)', 'Each take-off and each landing already counts as one flight; doubling counts them twice.'),
          off('pax', 'Passengers per flight', 'Only needed if you go from passengers (the demand side).'),
          off('pop', 'Population of the city', "Demand-side driver: doesn't fit a capacity tree."),
          off('terminals', 'Number of terminals', 'Terminals limit passengers, not runway movements.'),
          unit('days', '× 365 days', 'The question is per day.'),
        ],
        unit: 'flights a day',
        per: (x) => `${whole(x / 17)} flights an hour, one every ${whole(3600 / (x / 17))} seconds`,
      };
    },
  },
  {
    id: 'sizing.cars',
    name: 'New cars sold per year',
    archetype: 'Stock vs flow',
    scope: 'country',
    build: (R) => ({
      question: `How many new cars are sold in ${R.name} each year?`,
      clarify: { questions: ['New cars only, or used cars too?', 'Private and company cars?'], answer: 'New cars, bought by people and companies.' },
      facts: facts(R, [CARS]),
      angles: [
        D(true, 'Cars on the road (the stock) ÷ how long each lasts gives the yearly flow of replacements.', true),
        S(true, 'Dealerships × cars each sells a year also works.'),
        P(false, "You'd need a known sales figure to scale from."),
      ],
      tree: [
        popD(R),
        assume('perCar', '÷', 'People per car', 'How many people are there per car?', 'people', 2, 'About one car for every two people in Western Europe.'),
        assume('years', '÷', 'Years a car stays on the road', 'How many years does a car stay on the road?', 'years', 14, 'Cars are kept 12–15 years in total, across several owners.'),
      ],
      extras: [
        peopleTrap('Cars are worked out'),
        off('used', 'Used car sales', 'Used cars change hands but no new car is sold.'),
        price('a new car'),
        unit('months', '× 12 months', 'The car lifetime is already in years.'),
      ],
      unit: 'cars a year',
      per: (x) => `the whole stock of ${n(R.pop / 2)} cars replaced every ${fixed(R.pop / 2 / x, 1)} years`,
    }),
  },
  {
    id: 'sizing.cafe',
    name: "One café's daily takings",
    archetype: 'Single business revenue',
    scope: 'city',
    build: (R) => {
      const ticket = R.cur === '£' ? 6 : 5;
      return {
        question: `A client owns a busy café in central ${R.label}. Roughly what are its takings on a typical weekday, in ${R.cur}?`,
        clarify: { questions: ['Food and drinks both?', 'A weekday or a weekend?', 'Takings before or after costs?'], answer: 'All food and drink sold on a typical weekday, before costs.' },
        facts: ['A busy counter serves a customer every 1–2 minutes at peak'],
        angles: [
          S(true, "Capacity: customers it serves an hour × hours open × spend. Best for one outlet.", true),
          D(true, 'Footfall past the door × share who come in × spend also works.'),
          P(true, "If you know a chain's revenue per store, scale it to this café."),
        ],
        tree: [
          assume('hours', '', 'Hours open a day', 'How many hours a day is the café open?', 'hours', 11, 'Say 7am to 6pm.',
            { bands: [[4, 8, 6], [8, 12, 10], [12, 16, 14], [16, 24, 20]] }),
          assume('perHour', '×', 'Customers an hour (average)', 'On average, how many customers an hour?', 'customers', 30,
            'Queues of 60+ an hour at breakfast and lunch, quiet afternoons: about 30 on average.'),
          assume('ticket', '×', 'Spend per customer', `What does an average customer spend, in ${R.cur}?`, R.cur, ticket, 'A coffee plus sometimes a pastry or sandwich.', { money: true }),
        ],
        extras: [
          trap('seats', 'Number of seats', 'Customers an hour already counts who it serves; seats on top counts the same customers twice.'),
          off('pop', 'City population', 'A top-down driver: one café is sized bottom-up.'),
          off('rent', 'Monthly rent', 'A cost, not takings.'),
          off('cafes', 'Number of cafés in the city', 'Only needed for the whole market.'),
          unit('days', '× 365 days', 'The question is per day.'),
        ],
        unit: 'a day',
        money: true,
        per: (x) => `${whole(x / ticket)} customers a day spending ${R.cur}${ticket} each`,
      };
    },
  },
  {
    id: 'sizing.chairs',
    name: 'Office chairs bought by companies',
    archetype: 'B2B demand',
    scope: 'country',
    build: (R) => ({
      question: `How many office chairs do employers in ${R.name} buy each year?`,
      clarify: { questions: ['Desk chairs only, or meeting rooms and canteens too?', 'Private companies and the public sector?'], answer: 'Desk and meeting-room chairs, bought by any employer.' },
      facts: facts(R, ['About half of people are in work']),
      angles: [
        D(true, 'Office workers × chairs each ÷ chair lifetime: B2B demand built from people.', true),
        S(false, 'Few people know office-furniture makers well enough to size their output.'),
        P(false, "There's no common benchmark to scale from."),
      ],
      tree: [
        popD(R),
        assume('work', '×', '% in work', 'What share of people are in work?', '%', 50, 'About half: the rest are children, students, retirees and people not working.'),
        assume('office', '×', '% of workers at a desk', 'What share of workers have an office job?', '%', 40, 'Maybe 40%: shops, factories, care and building work have no desk.'),
        assume('chairs', '×', 'Chairs per office worker', 'How many chairs are there per office worker?', 'chairs', 1.2, 'A desk chair each, plus meeting rooms; hot-desking pulls it down.',
          { bands: [[0.3, 0.7, 0.5], [0.7, 1, 0.9], [1, 1.5, 1.2], [1.5, 3, 2]] }),
        assume('life', '÷', 'Years a chair lasts', 'How many years does an office chair last?', 'years', 8, 'About 7–10 years.'),
      ],
      extras: [
        trap('companies', 'Number of companies', 'You count workers already; companies on top counts them twice.'),
        off('hh', 'Number of households', 'Households buy home chairs; the question is employers.'),
        price('a chair'),
        unit('months', '× 12 months', 'The lifetime is already in years.'),
      ],
      unit: 'chairs a year',
      per: (x) => `every office chair replaced every ${fixed((R.pop * 0.5 * 0.4 * 1.2) / x, 1)} years`,
    }),
  },
  {
    id: 'sizing.viewing',
    name: 'Hours of online video watched',
    archetype: 'Time spent',
    scope: 'country',
    build: (R) => ({
      question: `How many hours of online video (streaming services, YouTube and so on) do people in ${R.name} watch on a typical day?`,
      clarify: { questions: ['Paid services only, or free ones like YouTube too?', 'At home only, or on phones on the go too?'], answer: 'Any online video, on any screen, anywhere.' },
      facts: facts(R),
      angles: [
        D(true, 'People × share who watch that day × hours each.', true),
        S(false, 'How much content exists says nothing about how much is watched.'),
        P(true, 'Average TV time per person (~3 hours a day) is a known benchmark to start from.'),
      ],
      tree: [
        popD(R),
        assume('share', '×', '% who watch online video that day', 'What share of people watch online video on a given day?', '%', 60, 'Most under-60s do; many older people mostly watch broadcast TV.'),
        assume('hours', '×', 'Hours per viewer', 'How many hours does each of them watch?', 'hours', 2, 'An evening series plus some short clips.',
          { bands: [[0.25, 1, 0.5], [1, 2, 1.5], [2, 4, 3], [4, 8, 5]] }),
      ],
      extras: [
        peopleTrap('Viewing is counted'),
        off('subs', 'Subscriptions × price', 'That sizes spend, not hours.'),
        off('services', 'Services per household', "More services don't add hours to the day."),
        unit('days', '× 365 days', 'The question is per day.'),
      ],
      unit: 'hours a day',
      per: (x) => `${fixed(x / R.pop, 1)} hours per person a day`,
    }),
  },
  {
    id: 'sizing.ticket',
    name: 'Profit on a cinema ticket',
    archetype: 'Value chain',
    scope: 'country',
    build: (R) => {
      const net = R.id === 'uk' ? 83 : 91;
      return {
        question: `A cinema in ${R.name} sells a ticket for ${R.cur}10. How much of that is the cinema's profit?`,
        clarify: { questions: ['Profit before or after tax on profits?', 'Ticket only, or including snacks?'], answer: 'Profit before corporate tax, on the ticket alone.' },
        facts: ['Film distributors usually take about half of ticket revenue', R.id === 'uk' ? 'UK VAT is 20%' : 'Many EU countries tax cinema tickets at a reduced VAT rate'],
        angles: [
          { label: 'Value chain: follow the ticket price through each cut', ok: true, why: 'Price → after VAT → after the film rental → after running costs.', mine: true },
          D(false, 'Demand drivers size the market, not how one ticket is split.'),
          P(true, "If you know a cinema chain's profit margin, you can apply it."),
        ],
        tree: [
          konst('price', '', `Ticket price (${R.cur}10)`, 10, 'Given in the question.'),
          assume('net', '×', '% left after VAT', 'What share of the price is left after VAT?', '%', net,
            R.id === 'uk' ? 'VAT is 20%, so 10 ÷ 1.2 ≈ 8.3: about 83% is left.' : 'Cinema tickets often get a reduced rate (around 10%), so ~91% is left.'),
          assume('kept', '×', '% the cinema keeps after film rental', 'What share does the cinema keep after paying the film distributor?', '%', 50, 'Distributors take about half, more in the opening weeks.'),
          assume('margin', '×', 'Profit margin on its share', 'What profit margin does the cinema make on its share?', '%', 15, 'Staff, rent and energy eat most of it; cinemas earn more on snacks.'),
        ],
        extras: [
          trap('distMargin', "Distributor's profit margin", "The distributor's whole cut is already gone; taking out their margin too counts it twice."),
          off('visits', 'Visits per person a year', 'That sizes the market, not one ticket.'),
          off('pop', 'Population', 'Not needed for one ticket.'),
          off('snacks', 'Snack margin', 'Snacks are where cinemas make money, but the question is the ticket.'),
        ],
        unit: 'per ticket',
        money: true,
        per: (x) => `${fixed(x * 10, 1)}% of the ticket price`,
      };
    },
  },
  {
    id: 'sizing.scooters',
    name: 'E-scooter rides (client case)',
    archetype: 'New market',
    scope: 'city',
    build: (R) => ({
      question: `A client wants to launch e-scooter sharing in ${R.name}. How many rides a day could the whole market reach?`,
      clarify: { questions: ['Shared scooters only, not privately owned ones?', 'Today, or once the market is mature?', 'All operators, or just our client?'], answer: 'Shared e-scooters, all operators, once the market is mature.' },
      facts: facts(R),
      angles: [
        D(true, 'Residents who would ride × rides a week ÷ 7.', true),
        S(true, 'Fleet size × rides per scooter a day is good once you know the fleet the city allows.'),
        P(true, 'Scale from a city that already has scooters, such as Paris before its 2023 ban.'),
      ],
      tree: [
        popD(R),
        assume('users', '×', '% of residents who ride', 'What share of residents would use shared scooters regularly?', '%', 4, 'A small, young, central group: maybe 3–5%.'),
        assume('perWeek', '×', 'Rides per user a week', 'How many rides does each of them take a week?', 'rides', 2, 'Short hops a couple of times a week.'),
        konst('days', '÷', '÷ 7 days', 7, 'Weekly to daily.'),
      ],
      extras: [
        peopleTrap('Riders are counted'),
        off('price', 'Price per ride', 'Rides, not revenue (although that is the natural next question).'),
        off('bikes', 'Bike-share docks', 'A different service.'),
        unit('month', '× 30 days', 'Rides a week ÷ 7 gives rides a day.'),
      ],
      unit: 'rides a day',
      per: (x) => `about ${whole(x / 3)} scooters on the street at ~3 rides each a day`,
    }),
  },
];

export const SIZING_BY_ID = Object.fromEntries(SIZING_TEMPLATES.map((t) => [t.id, t]));

function regionsFor(scope) {
  if (Array.isArray(scope)) return CITIES.filter((c) => scope.includes(c.id));
  if (scope === 'city') return CITIES;
  if (scope === 'country') return COUNTRIES;
  return [...COUNTRIES, ...CITIES];
}

// Every (case, region) pair
export const SIZING_COMBOS = SIZING_TEMPLATES.flatMap((t) =>
  regionsFor(t.scope).map((R) => ({ template: t, region: R, fingerprint: `${t.id}|${R.id}` }))
);

// ---------- maths on a tree ----------
const asNumber = (d, x) => (d.unit === '%' ? x / 100 : x);

// Run the chain with given values (yours or mine).
export function chainValue(tree, vals) {
  return tree.reduce((acc, d, i) => {
    const x = asNumber(d, vals[d.key]);
    if (i === 0) return x;
    return d.op === '÷' ? acc / x : acc * x;
  }, 0);
}

// "9M × 80% × 30% × 1.2"
export function chainText(tree, vals, cur) {
  return tree.map((d, i) => (i ? ` ${d.op} ` : '') + fmtDriver(d, vals[d.key], cur)).join('');
}

// "Population × % who are adults × … × 12 months"
export function treeText(blocks) {
  return blocks
    .map((d, i) => {
      const own = /^[×÷] /.test(d.block);
      if (i === 0) return own ? d.block.slice(2) : d.block;
      return own ? d.block : `${d.op || '×'} ${d.block}`;
    })
    .join(' ');
}

// Value display: 30%, €35, 2.6M
export function fmtDriver(d, value, cur) {
  if (value == null || !Number.isFinite(value)) return '–';
  if (d.unit === '%') return `${withCommas(roundSig(value, 3), 2)}%`;
  const num = Math.abs(value) >= 1000 ? fmtNum(roundSig(value, 2)) : withCommas(roundSig(value, 3), 2);
  return d.money ? `${cur}${num}` : num;
}

// Final-answer display, e.g. "2.4M", "£1,980", "£0.64"
export function fmtAnswer(c, value) {
  return fmtDriver({ money: c.money }, value, c.region.cur);
}

export const ratioOff = (a, b) => Math.max(a / b, b / a);

// ---------- ranges ----------
// 1-2-5 ladder of ranges with mine in one of four positions.
function ladderBands(value, rng) {
  const e = Math.floor(Math.log10(value));
  const edges = [];
  for (let k = e - 3; k <= e + 3; k++) for (const s of [1, 2, 5]) edges.push(roundSig(s * 10 ** k, 2));
  const i = edges.findIndex((x, j) => x <= value && value < edges[j + 1]);
  const start = i - rng.int(0, 3);
  return [0, 1, 2, 3].map((j) => {
    const lo = edges[start + j];
    const hi = edges[start + j + 1];
    const m = roundSig(lo / 10 ** Math.floor(Math.log10(lo)), 1);
    return [lo, hi, roundSig(lo * (m === 5 ? 1.4 : 1.5), 2)];
  });
}

export function bandsFor(d, rng) {
  const raw = d.bands ?? (d.unit === '%' ? PCT_BANDS : ladderBands(d.value, rng));
  return raw.map(([lo, hi, use]) => ({
    lo,
    hi,
    // a range that holds my number uses mine; otherwise its middle
    use: lo <= d.value && d.value <= hi ? d.value : use,
    mine: lo <= d.value && d.value <= hi,
  }));
}

export function bandLabel(d, b, cur) {
  const f = (x) => (x >= 1000 ? fmtNum(x) : withCommas(x, 2));
  const pre = d.money ? cur : '';
  if (d.unit === '%') return b.lo === 0 ? `<${b.hi}%` : b.hi === 100 ? `>${b.lo}%` : `${b.lo}–${b.hi}%`;
  if (b.lo === b.hi) return pre + f(b.lo);
  return `${pre}${f(b.lo)}–${f(b.hi)}`;
}

// ---------- building a case ----------
function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function makeCase({ template: t, region: R, fingerprint }, rng = createRng()) {
  const built = t.build(R);
  const ref = Object.fromEntries(built.tree.map((d) => [d.key, d.value]));
  const answer = chainValue(built.tree, ref);
  const bands = Object.fromEntries(built.tree.filter((d) => d.kind !== 'const').map((d) => [d.key, bandsFor(d, rng)]));
  return {
    templateId: t.id,
    name: t.name,
    archetype: t.archetype,
    region: R,
    fingerprint,
    ...built,
    money: built.money ?? false,
    ref,
    answer,
    bands,
    blocks: shuffle([...built.tree, ...built.extras], rng),
    colleague: colleagueAnswer(answer, rng),
  };
}

// A colleague's answer for the sense check: about right, ~10× too high or ~10× too low.
function colleagueAnswer(answer, rng) {
  const verdict = rng.pick(['ok', 'high', 'low']);
  const base = { ok: 1, high: 10, low: 0.1 }[verdict];
  const wobble = verdict === 'ok' ? 0.75 + rng.next() * 0.5 : 0.8 + rng.next() * 0.6;
  return { verdict, value: roundSig(answer * base * wobble, 2) };
}

// Grade a tree you built (blocks in the order you tapped them).
export function gradeTree(c, picked) {
  const want = c.tree.map((d) => d.key);
  const keys = picked.map((d) => d.key);
  const yourOrder = keys.filter((k) => want.includes(k));
  const myOrder = want.filter((k) => keys.includes(k));
  const missed = c.tree.filter((d) => !keys.includes(d.key));
  const wrong = picked.filter((d) => !want.includes(d.key));
  const inOrder = yourOrder.every((k, i) => k === myOrder[i]);
  return { ok: missed.length === 0 && wrong.length === 0, found: yourOrder.length, total: want.length, missed, wrong, inOrder };
}

// Four approaches for "Pick the approach": one right, three each with one flaw.
export function approaches(c, rng = createRng()) {
  const tree = c.tree;
  const flawed = [];
  const traps = c.extras.filter((x) => x.kind === 'trap');
  if (traps.length) {
    const t = rng.pick(traps);
    flawed.push({ blocks: insertAt(tree, 1, t), ok: false, flaw: `Double counts: ${t.why}` });
  }
  const consts = tree.filter((d) => d.kind === 'const' && d !== tree[0]);
  const units = c.extras.filter((x) => x.kind === 'unit');
  if (consts.length) {
    const k = rng.pick(consts);
    flawed.push({ blocks: tree.filter((d) => d !== k), ok: false, flaw: `Mixes up units: it leaves out "${k.block}" (${k.note.toLowerCase().replace(/\.$/, '')}).` });
  } else if (units.length) {
    const u = rng.pick(units);
    flawed.push({ blocks: [...tree, u], ok: false, flaw: `Mixes up units: ${u.why}` });
  }
  const droppable = tree.filter((d, i) => i > 0 && d.kind !== 'const');
  if (droppable.length && tree.length > 2) {
    const m = rng.pick(droppable);
    flawed.push({ blocks: tree.filter((d) => d !== m), ok: false, flaw: `Misses a driver: ${lowerFirst(m.block)}.` });
  }
  for (const o of shuffle(c.extras.filter((x) => x.kind === 'off'), rng)) {
    if (flawed.length >= 3) break;
    flawed.push({ blocks: [...tree, o], ok: false, flaw: `Adds a driver that doesn't belong: ${o.why}` });
  }
  return shuffle([{ blocks: tree, ok: true, flaw: 'Right: every driver once, nothing extra.' }, ...flawed.slice(0, 3)], rng);
}

const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

function insertAt(arr, i, x) {
  return [...arr.slice(0, i), x, ...arr.slice(i)];
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
    return makeCase(combo, this.rng);
  }
}
