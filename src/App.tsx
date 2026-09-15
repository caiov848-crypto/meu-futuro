import type { ComponentType } from 'react';
import type { IconName } from './ui/Icon';
import { useFinance } from './state/finance';
import { useUI, type Tab } from './state/ui';
import { Icon } from './ui/Icon';
import { TodayScreen } from './features/today/TodayScreen';
import { ForecastScreen } from './features/forecast/ForecastScreen';
import { PlanScreen } from './features/plan/PlanScreen';
import { MoreScreen } from './features/more/MoreScreen';
import { EntrySheet } from './features/entry/EntrySheet';
import { Welcome } from './features/onboarding/Welcome';

const TABS: { tab: Tab; label: string; icon: IconName }[] = [
  { tab: 'today', label: 'Hoje', icon: 'today' },
  { tab: 'forecast', label: 'Previsão', icon: 'forecast' },
  { tab: 'plan', label: 'Planejar', icon: 'plan' },
  { tab: 'more', label: 'Mais', icon: 'more' },
];

const SCREENS: Record<Tab, ComponentType> = {
  today: TodayScreen,
  forecast: ForecastScreen,
  plan: PlanScreen,
  more: MoreScreen,
};

export default function App() {
  const { snapshot } = useFinance();
  const ui = useUI();
  if (!snapshot.settings.onboarded) return <Welcome />;
  const Screen = SCREENS[ui.tab];

  const tabButton = (t: (typeof TABS)[number]) => (
    <button key={t.tab} className="tab" aria-current={ui.tab === t.tab ? 'page' : undefined} onClick={() => ui.setTab(t.tab)}>
      <Icon name={t.icon} size={22} />
      {t.label}
    </button>
  );

  return (
    <div className="app">
      <main key={ui.tab}>
        <Screen />
      </main>
      <nav className="tabbar" aria-label="Navegação principal">
        <div className="tabbar-inner">
          {TABS.slice(0, 2).map(tabButton)}
          <button className="fab" aria-label="Novo lançamento" onClick={() => ui.openSheet((c) => <EntrySheet close={c} />)}>
            <Icon name="plus" size={26} stroke={2.4} />
          </button>
          {TABS.slice(2).map(tabButton)}
        </div>
      </nav>
    </div>
  );
}
