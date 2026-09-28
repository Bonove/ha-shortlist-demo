export const metadata = { title: 'Sign in · HousingAnywhere shortlist prototype' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next = '/' } = await searchParams;

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '70dvh' }}>
      <form
        method="post"
        action="/api/login"
        className="card card-pad col"
        style={{ gap: 16, width: 380, padding: 28 }}
      >
        <div>
          <h1 style={{ fontSize: 20 }}>Shortlist prototype</h1>
          <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>
            A demonstration of policy-driven housing recommendations. Enter the shared password to continue.
          </p>
        </div>

        <input type="hidden" name="next" value={next} />
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            className="input"
            autoFocus
            autoComplete="current-password"
            required
          />
        </div>

        {error && (
          <div className="pill pill-nofit" style={{ alignSelf: 'flex-start' }}>
            That password is not right.
          </div>
        )}

        <button className="btn btn-primary" type="submit">
          Continue
        </button>

        <p className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
          All listings, prices and policies in this prototype are fictional demonstration data.
        </p>
      </form>
    </div>
  );
}
