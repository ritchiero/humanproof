export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-2xl text-center">
        <h1 className="text-5xl font-bold mb-4">
          Human<span className="text-hp-accent">Proof</span>
        </h1>
        <p className="text-xl text-gray-300 mb-8">
          AI Authorship Evidence Logger
        </p>
        <p className="text-gray-400 mb-12">
          Automatically captures and documents your human-AI interactions.
          Generates verifiable evidence reports for copyright registration.
        </p>
        <div className="flex gap-4 justify-center">
          <a
            href="/dashboard"
            className="px-6 py-3 bg-hp-accent text-white rounded-lg font-medium hover:opacity-90 transition"
          >
            Open Dashboard
          </a>
          <a
            href="https://github.com/TODO"
            className="px-6 py-3 border border-gray-600 text-gray-300 rounded-lg font-medium hover:border-gray-400 transition"
          >
            Install Extension
          </a>
        </div>
      </div>
    </main>
  );
}
