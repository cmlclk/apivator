// Sahte veri üretecinin İngilizce (ABD biçimli) veri kümesi (fakeData.ts).
import type { FakeCity, FakeLocaleData } from './fakeData';

const words = (text: string) => text.split(/\s+/).filter(Boolean);
const list = (text: string) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Şehir, eyalet kısaltması (ilçe yerine) ve ZIP kodunun ilk üç hanesi. */
const CITIES: readonly FakeCity[] = [
  ['New York', 'NY', '100'],
  ['Los Angeles', 'CA', '900'],
  ['Chicago', 'IL', '606'],
  ['Houston', 'TX', '770'],
  ['Phoenix', 'AZ', '850'],
  ['Philadelphia', 'PA', '191'],
  ['San Diego', 'CA', '921'],
  ['Austin', 'TX', '787'],
  ['Seattle', 'WA', '981'],
  ['Denver', 'CO', '802'],
  ['Boston', 'MA', '021'],
  ['Portland', 'OR', '972'],
  ['Atlanta', 'GA', '303'],
  ['Miami', 'FL', '331'],
  ['San Francisco', 'CA', '941'],
  ['Minneapolis', 'MN', '554'],
].map(([name, state, prefix]) => ({ name: name!, districts: [state!], postalPrefix: prefix! }));

export const FAKE_DATA_EN: FakeLocaleData = {
  maleNames: words(
    `James John Robert Michael William David Richard Joseph Thomas Charles Daniel Matthew Anthony Mark Paul
     Steven Andrew Joshua Kevin Brian George Edward Ryan Jacob Gary Nicholas Eric Jonathan Justin Samuel`,
  ),
  femaleNames: words(
    `Mary Patricia Jennifer Linda Elizabeth Barbara Susan Jessica Sarah Karen Lisa Nancy Betty Sandra Ashley
     Emily Donna Michelle Carol Amanda Melissa Deborah Laura Rebecca Sharon Emma Olivia Sophia Grace Chloe`,
  ),
  lastNames: words(
    `Smith Johnson Williams Brown Jones Garcia Miller Davis Rodriguez Martinez Wilson Anderson Taylor Thomas
     Moore Jackson Martin Lee Thompson White Harris Clark Lewis Robinson Walker Young Allen King Wright Scott
     Green Baker Adams Nelson Hill Campbell Mitchell Roberts Carter Phillips Evans Turner Parker Collins Edwards`,
  ),
  cities: CITIES,
  neighborhoods: [],
  streets: list(
    'Main, Oak, Pine, Maple, Cedar, Elm, Washington, Lake, Hill, Park, Sunset, Lincoln, Jackson, River, ' +
      'Highland, Meadow, Forest, Spring, Church, Willow',
  ),
  streetTypes: ['St', 'Ave', 'Rd', 'Blvd', 'Ln', 'Dr'],
  companyWords: list(
    'Summit, Northwind, Bluebird, Evergreen, Pioneer, Horizon, Keystone, Redwood, Silverline, Brightway, ' +
      'Ironclad, Granite',
  ),
  companySectors: list(
    'Logistics, Software, Foods, Energy, Consulting, Systems, Labs, Media, Health, Partners, Analytics, Design',
  ),
  companySuffixes: ['Inc.', 'LLC', 'Ltd.', 'Group', 'Co.'],
  jobTitles: list(
    'Software Engineer, Senior Software Engineer, Project Manager, Accountant, HR Specialist, Sales Representative, ' +
      'Marketing Manager, Data Analyst, System Administrator, Graphic Designer, Customer Support Agent, ' +
      'Finance Manager, Product Manager, QA Engineer, Logistics Coordinator, Attorney, Architect, Nurse, Teacher',
  ),
  colorNames: list('red, green, blue, yellow, purple, orange, black, white, pink, gray, navy, brown'),
  words: list(
    'alpha, bravo, delta, nova, pixel, harbor, lantern, meadow, orbit, quartz, ripple, summit, timber, vector, ' +
      'willow, zephyr, beacon, cobalt, ember, falcon',
  ),
};
