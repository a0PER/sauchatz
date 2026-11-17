import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cx } from '../ui';

// Each entry: emoji and search words.
type E = [string, string];

const CATEGORIES: { id: string; label: string; icon: string; emojis: E[] }[] = [
  {
    id: 'smileys', label: 'Smileys', icon: '😀', emojis: [
      ['😀', 'grin smile happy'], ['😃', 'smile happy'], ['😄', 'smile laugh'], ['😁', 'grin beam'], ['😆', 'laugh'], ['😅', 'sweat laugh'],
      ['🤣', 'rofl laugh'], ['😂', 'joy tears laugh'], ['🙂', 'slight smile'], ['🙃', 'upside down'], ['😉', 'wink'], ['😊', 'blush smile'],
      ['😇', 'angel halo'], ['🥰', 'love hearts'], ['😍', 'heart eyes love'], ['🤩', 'star struck'], ['😘', 'kiss'], ['😗', 'kiss'],
      ['😋', 'yum tasty'], ['😛', 'tongue'], ['😜', 'wink tongue'], ['🤪', 'zany crazy'], ['😝', 'tongue squint'], ['🤗', 'hug'],
      ['🤭', 'oops giggle'], ['🤫', 'shush quiet'], ['🤔', 'thinking'], ['🤐', 'zipper mouth'], ['🤨', 'raised eyebrow'], ['😐', 'neutral'],
      ['😑', 'expressionless'], ['😶', 'no mouth'], ['😏', 'smirk'], ['😒', 'unamused'], ['🙄', 'eye roll'], ['😬', 'grimace'],
      ['😌', 'relieved'], ['😔', 'pensive sad'], ['😪', 'sleepy'], ['😴', 'sleeping'], ['😷', 'mask sick'], ['🤒', 'sick thermometer'],
      ['🥵', 'hot'], ['🥶', 'cold'], ['🥴', 'woozy'], ['😵', 'dizzy'], ['🤯', 'mind blown'], ['🤠', 'cowboy'],
      ['🥳', 'party celebrate'], ['😎', 'cool sunglasses'], ['🤓', 'nerd'], ['🧐', 'monocle'], ['😕', 'confused'], ['😟', 'worried'],
      ['🙁', 'frown'], ['😮', 'surprised wow'], ['😲', 'astonished'], ['😳', 'flushed'], ['🥺', 'pleading puppy eyes'], ['😢', 'cry sad'],
      ['😭', 'sob cry'], ['😱', 'scream'], ['😖', 'confounded'], ['😣', 'persevere'], ['😞', 'disappointed'], ['😓', 'sweat'],
      ['😩', 'weary'], ['😫', 'tired'], ['🥱', 'yawn'], ['😤', 'triumph huff'], ['😡', 'angry mad'], ['😠', 'angry'],
      ['🤬', 'swearing'], ['💀', 'skull dead'], ['🤡', 'clown'], ['👻', 'ghost'], ['👽', 'alien'], ['🤖', 'robot'],
    ],
  },
  {
    id: 'gestures', label: 'People', icon: '👍', emojis: [
      ['👍', 'thumbs up yes like'], ['👎', 'thumbs down no'], ['👌', 'ok'], ['🤌', 'pinched fingers'], ['✌️', 'peace victory'], ['🤞', 'fingers crossed luck'],
      ['🤟', 'love you'], ['🤘', 'rock'], ['🤙', 'call me'], ['👈', 'left'], ['👉', 'right'], ['👆', 'up'],
      ['👇', 'down'], ['☝️', 'point up'], ['👋', 'wave hello bye'], ['🤚', 'raised hand'], ['✋', 'hand stop'], ['🖐️', 'hand'],
      ['👏', 'clap'], ['🙌', 'raise hands praise'], ['👐', 'open hands'], ['🤲', 'palms up'], ['🙏', 'pray please thanks'], ['🤝', 'handshake'],
      ['💪', 'strong muscle'], ['🫶', 'heart hands'], ['✍️', 'writing'], ['👀', 'eyes look'], ['🧠', 'brain'], ['🫡', 'salute'],
      ['🤷', 'shrug'], ['🤦', 'facepalm'], ['🙋', 'raising hand'], ['🙇', 'bow'], ['💃', 'dance'], ['🕺', 'dance'],
      ['🏃', 'run'], ['🚶', 'walk'], ['🧑‍🎓', 'student graduate'], ['🧑‍🏫', 'teacher'], ['🧑‍💻', 'coder laptop'], ['👯', 'friends'],
    ],
  },
  {
    id: 'hearts', label: 'Hearts', icon: '❤️', emojis: [
      ['❤️', 'red heart love'], ['🧡', 'orange heart'], ['💛', 'yellow heart'], ['💚', 'green heart'], ['💙', 'blue heart'], ['💜', 'purple heart'],
      ['🖤', 'black heart'], ['🤍', 'white heart'], ['🤎', 'brown heart'], ['💔', 'broken heart'], ['❣️', 'heart exclamation'], ['💕', 'two hearts'],
      ['💞', 'revolving hearts'], ['💓', 'beating heart'], ['💗', 'growing heart'], ['💖', 'sparkling heart'], ['💘', 'cupid arrow'], ['💝', 'heart ribbon gift'],
      ['💯', 'hundred perfect'], ['✨', 'sparkles'], ['🔥', 'fire lit'], ['⭐', 'star'], ['🌟', 'glowing star'], ['💫', 'dizzy star'],
      ['💥', 'boom'], ['💤', 'zzz sleep'], ['💬', 'speech bubble'], ['💭', 'thought'], ['🎉', 'party tada'], ['🎊', 'confetti'],
    ],
  },
  {
    id: 'nature', label: 'Nature', icon: '🐶', emojis: [
      ['🐶', 'dog puppy'], ['🐱', 'cat'], ['🐭', 'mouse'], ['🐰', 'rabbit bunny'], ['🦊', 'fox'], ['🐻', 'bear'],
      ['🐼', 'panda'], ['🐨', 'koala'], ['🐯', 'tiger'], ['🦁', 'lion'], ['🐮', 'cow'], ['🐷', 'pig'],
      ['🐸', 'frog'], ['🐵', 'monkey'], ['🙈', 'see no evil'], ['🐔', 'chicken'], ['🐧', 'penguin'], ['🐦', 'bird'],
      ['🦋', 'butterfly'], ['🐢', 'turtle'], ['🐍', 'snake'], ['🐙', 'octopus'], ['🐬', 'dolphin'], ['🐳', 'whale'],
      ['🌸', 'blossom flower'], ['🌹', 'rose'], ['🌻', 'sunflower'], ['🌷', 'tulip'], ['🌱', 'seedling plant'], ['🌲', 'tree'],
      ['🍀', 'clover luck'], ['🍁', 'maple leaf fall'], ['🌈', 'rainbow'], ['☀️', 'sun'], ['🌙', 'moon night'], ['⛅', 'cloud sun'],
      ['🌧️', 'rain'], ['⛈️', 'storm'], ['❄️', 'snow'], ['⛄', 'snowman'], ['🌊', 'wave ocean'], ['⛰️', 'mountain hike'],
    ],
  },
  {
    id: 'food', label: 'Food', icon: '🍕', emojis: [
      ['🍎', 'apple'], ['🍌', 'banana'], ['🍉', 'watermelon'], ['🍇', 'grapes'], ['🍓', 'strawberry'], ['🍑', 'peach'],
      ['🍍', 'pineapple'], ['🥑', 'avocado'], ['🥦', 'broccoli'], ['🌽', 'corn'], ['🥕', 'carrot'], ['🍞', 'bread'],
      ['🥐', 'croissant'], ['🥞', 'pancakes'], ['🧇', 'waffle'], ['🧀', 'cheese'], ['🍕', 'pizza'], ['🌮', 'taco'],
      ['🌯', 'burrito'], ['🥗', 'salad'], ['🍝', 'pasta spaghetti'], ['🍜', 'ramen noodles'], ['🍣', 'sushi'], ['🍿', 'popcorn'],
      ['🍩', 'donut'], ['🍪', 'cookie'], ['🎂', 'birthday cake'], ['🧁', 'cupcake'], ['🍫', 'chocolate'], ['🍦', 'ice cream'],
      ['☕', 'coffee'], ['🍵', 'tea'], ['🧋', 'boba bubble tea'], ['🥤', 'drink soda'], ['🧃', 'juice'], ['🥛', 'milk'],
    ],
  },
  {
    id: 'activities', label: 'Activities', icon: '⚽', emojis: [
      ['⚽', 'soccer football'], ['🏀', 'basketball'], ['🏈', 'football'], ['⚾', 'baseball'], ['🎾', 'tennis'], ['🏐', 'volleyball'],
      ['🏓', 'ping pong'], ['🏸', 'badminton'], ['🥏', 'frisbee'], ['🏊', 'swim'], ['🚴', 'bike cycling'], ['🧗', 'climbing'],
      ['🏆', 'trophy win'], ['🥇', 'gold medal first'], ['🎮', 'video game'], ['🎲', 'dice board game'], ['🧩', 'puzzle'], ['🎯', 'target'],
      ['🎨', 'art paint'], ['🎬', 'movie film'], ['🎤', 'microphone sing'], ['🎧', 'headphones music'], ['🎸', 'guitar'], ['🎹', 'piano'],
      ['🎻', 'violin'], ['🥁', 'drum'], ['🎵', 'music note'], ['📚', 'books study'], ['📖', 'book read'], ['✏️', 'pencil'],
    ],
  },
  {
    id: 'travel', label: 'Places', icon: '🚗', emojis: [
      ['🚗', 'car'], ['🚕', 'taxi'], ['🚌', 'bus'], ['🚲', 'bicycle'], ['🛴', 'scooter'], ['✈️', 'plane travel'],
      ['🚀', 'rocket'], ['⛵', 'boat'], ['🏠', 'home house'], ['🏫', 'school'], ['🏛️', 'building'], ['⛪', 'church'],
      ['🏕️', 'camping'], ['🏖️', 'beach'], ['🏔️', 'snow mountain'], ['🗺️', 'map'], ['🌎', 'earth world'], ['🌃', 'night city'],
    ],
  },
  {
    id: 'objects', label: 'Objects', icon: '💡', emojis: [
      ['📱', 'phone'], ['💻', 'laptop'], ['⌚', 'watch'], ['📷', 'camera'], ['💡', 'idea light bulb'], ['🔑', 'key'],
      ['🎁', 'gift present'], ['🎈', 'balloon'], ['📌', 'pin'], ['📎', 'paperclip'], ['📝', 'memo note'], ['📅', 'calendar'],
      ['⏰', 'alarm clock'], ['💸', 'money'], ['🛒', 'shopping'], ['👕', 'shirt'], ['👟', 'shoe'], ['🎒', 'backpack'],
      ['✅', 'check done'], ['❌', 'cross no'], ['⚠️', 'warning'], ['❓', 'question'], ['❗', 'exclamation'], ['➕', 'plus'],
      ['🆗', 'ok'], ['🆒', 'cool'], ['🆕', 'new'], ['🔔', 'bell'], ['🔒', 'lock'], ['♻️', 'recycle'],
    ],
  },
];

const RECENT_KEY = 'sauchatz-recent-emojis';
const ALL: E[] = CATEGORIES.flatMap((c) => c.emojis);

function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}

/** True when a message is only 1 to 3 emojis (shown larger). */
export function isEmojiOnly(text: string) {
  const t = text.trim();
  if (!t || t.length > 24) return false;
  const stripped = t.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️⃣\s]/gu, '');
  if (stripped.length > 0) return false;
  const count = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)].filter((s) => s.segment.trim()).length;
  return count >= 1 && count <= 3;
}

export function EmojiPicker({ onPick, onClose, align = 'left' }: { onPick: (emoji: string) => void; onClose: () => void; align?: 'left' | 'right' }) {
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [active, setActive] = useState(recent.length ? 'recent' : 'smileys');
  const root = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    if (window.matchMedia('(pointer: fine)').matches) searchRef.current?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  function pick(emoji: string) {
    const next = [emoji, ...recent.filter((e) => e !== emoji)].slice(0, 24);
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    onPick(emoji);
  }

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return ALL.filter(([, words]) => words.includes(q)).map(([e]) => e);
  }, [query]);

  const shown: string[] = results
    ?? (active === 'recent' ? recent : (CATEGORIES.find((c) => c.id === active)?.emojis ?? []).map(([e]) => e));
  const title = results ? 'Search results' : active === 'recent' ? 'Recently used' : CATEGORIES.find((c) => c.id === active)?.label;

  return (
    <div
      ref={root}
      role="dialog"
      aria-label="Emoji picker"
      className={cx('animate-in absolute bottom-full z-40 mb-2 w-[min(340px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-line bg-surface shadow-panel', align === 'right' ? 'right-0' : 'left-0')}
    >
      <div className="p-2.5 pb-1.5">
        <div className="flex h-9 items-center gap-2 rounded-lg bg-surface-2 px-2.5">
          <Search size={15} className="shrink-0 text-subtle" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search emojis"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-subtle"
          />
        </div>
      </div>
      {!results && (
        <div className="flex gap-0.5 overflow-x-auto px-2 pb-1">
          {recent.length > 0 && (
            <button onClick={() => setActive('recent')} title="Recently used" className={cx('rounded-lg px-2 py-1 text-lg', active === 'recent' ? 'bg-accent-soft' : 'hover:bg-surface-2')}>🕘</button>
          )}
          {CATEGORIES.map((c) => (
            <button key={c.id} onClick={() => setActive(c.id)} title={c.label} className={cx('rounded-lg px-2 py-1 text-lg', active === c.id ? 'bg-accent-soft' : 'hover:bg-surface-2')}>
              {c.icon}
            </button>
          ))}
        </div>
      )}
      <div className="px-3 pb-1 pt-1 text-xs font-medium text-muted">{title}</div>
      <div className="scroll-thin grid h-[220px] grid-cols-8 content-start gap-0.5 overflow-y-auto px-2 pb-2">
        {shown.length === 0 ? (
          <p className="col-span-8 py-8 text-center text-sm text-muted">No emojis found.</p>
        ) : (
          shown.map((e) => (
            <button key={e} onClick={() => pick(e)} className="flex aspect-square items-center justify-center rounded-lg text-[22px] leading-none hover:bg-surface-2" aria-label={`Insert ${e}`}>
              {e}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
