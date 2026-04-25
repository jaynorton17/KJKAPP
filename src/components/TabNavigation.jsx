const TAB_LABELS = {
  game: 'Game',
  questions: 'Questions',
  history: 'History',
  analytics: 'Analytics',
  export: 'Export',
  settings: 'Settings',
};

const TAB_TONES = {
  game: 'lobby',
  questions: 'active',
  history: 'archive',
  analytics: 'analytics',
  export: 'store',
  settings: 'pending',
};

function TabNavigation({ activeTab, tabs, onChange }) {
  return (
    <nav className="tab-nav" aria-label="KJK KIMJAYKINKS sections">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`dashboard-pill tab-button dashboard-pill--${TAB_TONES[tab.id] || 'lobby'} ${activeTab === tab.id ? 'is-active' : ''}`}
          onClick={() => onChange(tab.id)}
          aria-current={activeTab === tab.id ? 'page' : undefined}
        >
          <span>{TAB_LABELS[tab.id] || tab.label}</span>
          {tab.meta ? <small>{tab.meta}</small> : null}
        </button>
      ))}
    </nav>
  );
}

export default TabNavigation;
