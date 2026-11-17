import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { APP_NAME } from '../config';
import { Logo } from '../components/ui';

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: 'Who can use Sauchatz',
    body: [
      `${APP_NAME} is for current Southern Adventist University students who are 18 or older.`,
      `${APP_NAME} is an independent student project. It is not affiliated with, endorsed by, or run by Southern Adventist University.`,
    ],
  },
  {
    title: 'What other members can see',
    body: [
      'Your name, profile picture, description and, if your profile is public, your photos and profile details.',
      'Other members never see your email address or phone number.',
      'Messages in a private chat or group can be read by the people in that chat.',
    ],
  },
  {
    title: 'What admins can see',
    body: [
      'Admins cannot browse your chats. When someone reports a message, admins see that reported message so they can act on it.',
      'Admins can see account details such as email, phone number (if you added one), sign-up date and last sign-in, and can delete accounts that break these rules.',
      'Nobody, including admins, can see your password. It is stored scrambled.',
      'A chat PIN hides a chat from anyone using your device.',
    ],
  },
  {
    title: 'Community rules',
    body: [
      'Be respectful. No harassment, threats, hate, or bullying.',
      'No nudity or sexual content, and no spam, scams or selling.',
      'Do not pretend to be someone else, and do not share other people\'s private information.',
      'Report anything that breaks these rules. Accounts that break them can be removed.',
    ],
  },
  {
    title: 'Your data',
    body: [
      'You can edit your profile or delete your account at any time in Settings. Deleting your account removes your profile, photos and messages.',
      'Data is stored with Supabase and the site is hosted by Cloudflare. Everything is sent over an encrypted connection.',
    ],
  },
];

export default function PrivacyPage() {
  const navigate = useNavigate();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-5 pb-16 pt-8">
        <div className="mb-8 flex items-center gap-3">
          <button onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))} className="rounded-full p-2 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Back">
            <ArrowLeft size={20} />
          </button>
          <Logo size={28} />
          <span className="text-[17px] font-semibold text-ink">{APP_NAME}</span>
        </div>
        <h1 className="text-[28px] font-semibold tracking-tight text-ink">Privacy and rules</h1>
        <p className="mt-2 text-sm text-muted">Please read this before you join. By creating an account you agree to it.</p>
        <div className="mt-8 space-y-8">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h2 className="text-[17px] font-semibold text-ink">{s.title}</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-ink">
                {s.body.map((b) => <li key={b}>{b}</li>)}
              </ul>
            </section>
          ))}
        </div>
        <p className="mt-10 text-sm text-muted">
          Questions? Contact the {APP_NAME} admin. <Link to="/" className="font-medium text-accent hover:underline">Back to {APP_NAME}</Link>
        </p>
      </div>
    </div>
  );
}
