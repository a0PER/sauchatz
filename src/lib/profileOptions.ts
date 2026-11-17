export const CLASS_YEARS = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate', 'Other'] as const;

export const HERE_FOR = ['Friends', 'Dating', 'Study partners', 'Hanging out', 'Roommates', 'Networking'] as const;

export const INTEREST_SUGGESTIONS = [
  'Hiking', 'Coffee', 'Music', 'Worship team', 'Basketball', 'Soccer', 'Volleyball', 'Photography', 'Cooking',
  'Baking', 'Gaming', 'Reading', 'Movies', 'Art', 'Running', 'Gym', 'Climbing', 'Traveling', 'Thrifting',
  'Board games', 'Piano', 'Guitar', 'Singing', 'Camping', 'Kayaking', 'Volunteering', 'Fashion', 'Anime',
];

export const PROMPT_QUESTIONS = [
  'A perfect Sabbath afternoon looks like',
  'My go-to spot on campus is',
  'I will never stop talking about',
  'The way to win me over is',
  'My most unpopular opinion is',
  'Two truths and a lie',
  'I am looking for someone who',
  'After graduation I want to',
  'The best meal at the dining hall is',
  'You will find me on weekends',
];

export const MAX_INTERESTS = 12;
export const MAX_PROMPTS = 3;
export const MAX_GALLERY = 9;

export function ageFrom(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate + 'T00:00:00');
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}
