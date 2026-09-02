import './PrivacyBanner.css';

export function PrivacyBanner() {
  return (
    <div className="privacy-banner">
      <span className="privacy-indicator" aria-hidden="true" />
      <div className="privacy-content">
        <strong>Local by default</strong>
        <span>No upload, no account, no document retention.</span>
      </div>
    </div>
  );
}

const features = [
  {
    number: '01',
    title: 'On-device',
    description: 'PDF parsing and comparison happen in this browser tab. Your files are not sent anywhere.',
  },
  {
    number: '02',
    title: 'Inspectable',
    description: 'The source is public, so the privacy claim can be checked instead of simply trusted.',
    href: 'https://github.com/qiu2025/diff',
  },
  {
    number: '03',
    title: 'Scriptable',
    description: 'The same comparison workflow is available from the command line for repeatable reviews.',
    href: '/cli.html',
  },
];

export function PrivacyFeatures() {
  return (
    <section className="privacy-features" aria-labelledby="privacy-title">
      <div className="privacy-features-intro">
        <p className="section-index">How it works</p>
        <h2 id="privacy-title">Your documents are none of our business.</h2>
        <p>A focused utility with a short data path: open, compare, close.</p>
      </div>
      <dl className="privacy-features-list">
        {features.map((feature) => (
          <div className="privacy-feature" key={feature.number}>
            <dt>
              <span>{feature.number}</span>
              {feature.href ? (
                <a
                  href={feature.href}
                  target={feature.href.startsWith('http') ? '_blank' : undefined}
                  rel={feature.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                >
                  {feature.title} ↗
                </a>
              ) : feature.title}
            </dt>
            <dd>{feature.description}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
