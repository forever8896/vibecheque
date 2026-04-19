import Link from "next/link";

// Marketing landing page for people arriving from outside the demo.
// Explains what the product is, who it's for, and funnels them to the
// gate at /play. Static — no webcam, no gating, loads fast.

export default function Landing() {
  return (
    <main className="relative flex flex-1 flex-col bg-black text-white">
      <BackgroundGlow />

      <nav className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Link
          href="/"
          className="font-mono text-sm uppercase tracking-[0.35em] text-white"
        >
          Vibe<span className="text-fuchsia-400">Cheque</span>
        </Link>
        <Link
          href="/play"
          className="rounded-full border border-white/15 bg-white/5 px-4 py-1.5 font-mono text-[11px] uppercase tracking-widest text-white backdrop-blur transition hover:border-fuchsia-400/60 hover:bg-fuchsia-500/15 hover:text-fuchsia-100"
        >
          Join the floor →
        </Link>
      </nav>

      <Hero />
      <Problem />
      <HowItWorks />
      <BYOD />
      <WhyItMatters />
      <FinalCTA />

      <footer className="relative z-10 mx-auto w-full max-w-6xl border-t border-white/5 px-6 py-8 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>VibeCheque · human-first dance floor</span>
          <div className="flex gap-4">
            <a
              href="https://github.com/forever8896/vibecheque"
              target="_blank"
              rel="noreferrer"
              className="hover:text-white"
            >
              source
            </a>
            <Link href="/play" className="hover:text-white">
              join →
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function BackgroundGlow() {
  // Ambient fuchsia glow behind the hero. Pure CSS — no animation cost.
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[900px] opacity-60"
      style={{
        background:
          "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(255, 77, 240, 0.35), transparent 70%)",
      }}
    />
  );
}

function Hero() {
  return (
    <section className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center gap-8 px-6 pb-24 pt-16 text-center md:pt-24">
      <p className="font-mono text-[10px] uppercase tracking-[0.5em] text-fuchsia-300/80">
        Multiplayer dance floor for humans
      </p>
      <h1 className="max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight text-white drop-shadow-[0_2px_40px_rgba(0,0,0,0.8)] md:text-7xl">
        Dance behind sunglasses.
        <br />
        <span className="text-fuchsia-300">Take them off</span> to meet the
        room.
      </h1>
      <p className="max-w-2xl text-lg text-zinc-300 md:text-xl">
        VibeCheque is an embodied icebreaker. Pick a song, dance with
        strangers anonymously, then take the glasses off and actually say hi —
        now that there&rsquo;s something shared to talk about.
      </p>
      <div className="flex flex-col items-center gap-3">
        <Link
          href="/play"
          className="rounded-full bg-fuchsia-500 px-8 py-3 font-mono text-sm font-semibold uppercase tracking-widest text-black shadow-[0_0_40px_rgba(255,77,240,0.55)] transition hover:scale-[1.02] hover:bg-fuchsia-400"
        >
          Join the floor
        </Link>
        <p className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">
          webcam + a pair of sunglasses · no download
        </p>
      </div>
    </section>
  );
}

function Problem() {
  return (
    <section className="relative z-10 mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 pb-20 pt-10 md:pb-28">
      <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-fuchsia-300/70">
        Why we built this
      </p>
      <h2 className="text-3xl font-semibold leading-tight text-white md:text-5xl">
        Nobody remembers how to meet anyone anymore.
      </h2>
      <div className="space-y-4 text-lg leading-relaxed text-zinc-300 md:text-xl">
        <p>
          Apps replaced rooms. Swipes replaced eye contact. The thing that
          used to turn a stranger into a friend — being in the same moment,
          together, doing the same slightly-ridiculous thing — got optimized
          out of modern life.
        </p>
        <p>
          VibeCheque puts it back. First you do something together. Then you
          talk. In that order.
        </p>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps: { n: string; title: string; body: string }[] = [
    {
      n: "01",
      title: "Put on sunglasses.",
      body: "A face-landmarker confirms them before it lets you in. Anonymity is the ice-breaker — nobody's being judged and nobody's being seen.",
    },
    {
      n: "02",
      title: "Pick a dance with your arm.",
      body: "Extend your right arm for next, left for previous. The library is the whole community's uploads. When you land on a song, the reference video starts playing for everyone in the room.",
    },
    {
      n: "03",
      title: "Dab to start. Dance with strangers.",
      body: "A pose skeleton tracks your body over the reference dancer. Everyone in the room is doing the same thing at the same time. Shared song, shared room, shared bad decisions.",
    },
    {
      n: "04",
      title: "Take the sunglasses off.",
      body: "Music ends. The chill room opens. Voice chat comes on, skeletons come off. Now you've already shared something real — use it.",
    },
  ];
  return (
    <section className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-24">
      <div className="mb-10 flex items-baseline justify-between gap-4">
        <h2 className="text-3xl font-semibold text-white md:text-5xl">
          How a round plays.
        </h2>
        <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-fuchsia-300/70">
          ~2 minutes
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {steps.map((s) => (
          <div
            key={s.n}
            className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur transition hover:border-fuchsia-400/40 hover:bg-fuchsia-500/5"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-fuchsia-300">
              {s.n}
            </p>
            <h3 className="mt-3 text-xl font-semibold text-white md:text-2xl">
              {s.title}
            </h3>
            <p className="mt-2 text-zinc-300">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function BYOD() {
  return (
    <section className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-24">
      <div className="overflow-hidden rounded-3xl border border-fuchsia-400/30 bg-fuchsia-500/[0.08] p-8 backdrop-blur md:p-12">
        <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-fuchsia-300">
          Bring your own dance
        </p>
        <h2 className="mt-3 text-3xl font-semibold leading-tight text-white md:text-5xl">
          Any video. Any song.
          <br />
          <span className="text-fuchsia-300">In the library in 30 seconds.</span>
        </h2>
        <p className="mt-4 max-w-2xl text-lg text-zinc-200">
          Drop in a clip of yourself dancing to a song you love. We extract
          the audio, pull out a full pose skeleton, and add it to the
          community library. The next stranger who swipes past your entry
          gets to try to follow your moves.
        </p>
        <ul className="mt-6 grid gap-3 text-sm text-zinc-300 md:grid-cols-3">
          <li className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-fuchsia-300">
              no login
            </span>
            <p className="mt-1">Drop a file, name it, done.</p>
          </li>
          <li className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-fuchsia-300">
              pose + music
            </span>
            <p className="mt-1">
              Phone clip in → sync-locked reference dance out.
            </p>
          </li>
          <li className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-fuchsia-300">
              community library
            </span>
            <p className="mt-1">
              Your upload is visible to everyone in the lobby.
            </p>
          </li>
        </ul>
      </div>
    </section>
  );
}

function WhyItMatters() {
  return (
    <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-24 text-center">
      <h2 className="text-3xl font-semibold leading-tight text-white md:text-5xl">
        Built for humans.
        <br />
        <span className="text-fuchsia-300">Not for machines.</span>
      </h2>
      <p className="mx-auto mt-5 max-w-2xl text-lg text-zinc-300 md:text-xl">
        You can&rsquo;t fake this with an LLM. You have to move, in front of a
        camera, in real time, with actual other people. That&rsquo;s the
        point.
      </p>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-24 text-center">
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-10 md:p-14">
        <h2 className="text-3xl font-semibold text-white md:text-4xl">
          The music&rsquo;s already playing.
        </h2>
        <p className="mt-3 text-lg text-zinc-300">
          Walk onto the floor. Dance with whoever&rsquo;s there. See what
          happens.
        </p>
        <Link
          href="/play"
          className="mt-8 inline-block rounded-full bg-fuchsia-500 px-8 py-3 font-mono text-sm font-semibold uppercase tracking-widest text-black shadow-[0_0_40px_rgba(255,77,240,0.55)] transition hover:scale-[1.02] hover:bg-fuchsia-400"
        >
          Join the floor
        </Link>
      </div>
    </section>
  );
}
