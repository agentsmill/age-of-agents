import type { HeroStateKind, BuildingId } from '@agent-citadel/shared';
import type { NotifReason } from './notifications';
import { useSettings, type Lang } from './settings';

/**
 * Lekkie i18n bez bibliotek. Domyślny język = angielski (EN), polski (PL) i
 * włoski (IT) jako przełączniki. Dwie warstwy: UI (chrome HUD) i BUILDINGS
 * (nazwy + opisy budynków).
 *
 * Ton: język LAICKI — dla bystrych, ale niekoniecznie technicznych osób.
 * Unikamy surowego żargonu (nazw narzędzi, „tokenów", „hooków") na rzecz
 * zwykłych słów; opis budynku tłumaczy, CO tam się dzieje, nie jakim API.
 */

export interface UiStrings {
  fantasy: string;
  scifi: string;
  hooksOn: string;
  hooksOff: string;
  hooksTitle: string;
  hooksInstall: string;
  hooksUninstall: string;
  tokensOut: string;
  tokensIn: string;
  connecting: string;
  missions: string;
  states: Record<HeroStateKind, string>;
  modelUnknown: string;
  transcriptHint: string;
  tok: string;
  workingNow: string;
  sessions: string;
  peons: string;
  tokenUsage: string;
  today: string;
  week: string;
  month: string;
  attribution: string;
  langLabel: string; // tekst przycisku przełącznika (pokazuje język DOCELOWY)
  zoomIn: string;
  zoomOut: string;
  zoomReset: string;
  produced: string;
  read: string;
  active: string;
  currentTask: string;
  recentActions: string;
  now: string;
  /** Etykiety powiadomień (powód → krótki tekst nagłówka). */
  notif: Record<NotifReason, string>;
  notifClose: string;
  notifJump: string;
  autofollow: string;
  autofollowHint: string;
  cities: string;
  agents: string;
  allCities: string;
  language: string;
  symbols: string;
  edges: string;
  communities: string;
  arsenal: string;
  skills: string;
  connectors: string;
  hooks: string;
  subagents: string;
  usedThisSession: string;
  scanningProject: string;
  // Panel ustawień (reakcje budynków)
  settings: string;
  buildingReactions: string;
  buildingReactionsHint: string;
  addTrigger: string;
  kindName: string;
  kindPattern: string;
  kindCondition: string;
  coverage: string;
  covCovered: string;
  covUnassigned: string;
  covConflicts: string;
  assign: string;
  socialBuildings: string;
  jsonSynced: string;
  jsonInvalid: string;
  restoreDefaults: string;
  addCondition: string;
  addPattern: string;
  toolName: string;
  pattern: string;
  remove: string;
  addTriggerConfirm: string;
}

const EN: UiStrings = {
  fantasy: 'Fantasy',
  scifi: 'Sci-Fi',
  hooksOn: '⚡ live: on',
  hooksOff: '⚡ live: off',
  hooksTitle: 'Update the world the instant your sessions do something (otherwise there is a ~1s delay)',
  hooksInstall:
    'Turn on live updates?\n\nThe world will react the moment your Claude Code sessions do something, instead of with a ~1 second delay. This adds a small entry to your Claude Code settings file (a backup is saved first). Your existing settings are left untouched.',
  hooksUninstall: 'Turn off live updates? (your other settings stay untouched)',
  tokensOut: 'Total work the agents have produced',
  tokensIn: 'Total amount the agents have read',
  connecting: '○ connecting…',
  missions: 'Tasks',
  states: {
    thinking: 'thinking',
    working: 'working',
    'awaiting-input': 'needs you!',
    idle: 'waiting',
    sleeping: 'asleep',
    error: 'hit a snag',
    returning: 'heading back',
  },
  modelUnknown: 'unknown model',
  transcriptHint: 'The conversation will show up here as the session does new work.',
  tok: 'k produced',
  workingNow: 'Busy here right now',
  sessions: 'sessions',
  peons: 'helpers',
  tokenUsage: 'Work done here',
  today: 'Today',
  week: 'Last 7 days',
  month: 'Last 30 days',
  attribution:
    'Estimated from each session’s activity. Work is credited to the building that matches what the agent was doing (counted in the AI’s units of text).',
  langLabel: 'PL',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  zoomReset: 'Reset view',
  produced: 'Produced',
  read: 'Read',
  active: 'Active',
  currentTask: 'Current task',
  recentActions: 'Recent actions',
  now: 'now',
  notif: {
    'needs-you': 'needs your call',
    error: 'hit a snag',
    'mission-done': 'task complete',
    'new-session': 'new session',
  },
  notifClose: 'Close',
  notifJump: 'click to jump',
  autofollow: 'Follow',
  autofollowHint: 'Camera follows this hero',
  cities: 'CITIES',
  agents: 'agents',
  allCities: 'All',
  language: 'Language',
  symbols: 'Symbols',
  edges: 'Edges',
  communities: 'Communities',
  arsenal: 'Arsenal',
  skills: 'Skills',
  connectors: 'Connectors',
  hooks: 'Hooks',
  subagents: 'Subagents',
  usedThisSession: 'used',
  scanningProject: 'Scanning project…',
  settings: 'Settings',
  buildingReactions: 'Building reactions',
  buildingReactionsHint: 'Pick which live-log tools each building reacts to. Edit visually or as JSON below — both stay in sync.',
  addTrigger: 'add (, or ;)',
  kindName: 'name',
  kindPattern: 'pattern',
  kindCondition: 'condition',
  coverage: 'Coverage',
  covCovered: 'working buildings covered',
  covUnassigned: 'tools fall to home base',
  covConflicts: 'conflicts',
  assign: 'assign',
  socialBuildings: 'Social buildings — driven by session state, no tool triggers.',
  jsonSynced: 'JSON — kept in sync with the panel',
  jsonInvalid: 'Invalid config — not applied',
  restoreDefaults: 'Restore defaults',
  addCondition: '+ condition',
  addPattern: '+ pattern',
  toolName: 'tool',
  pattern: 'regex',
  remove: 'Remove',
  addTriggerConfirm: 'Add trigger',
};

const PL: UiStrings = {
  fantasy: 'Fantasy',
  scifi: 'Sci-Fi',
  hooksOn: '⚡ na żywo: wł',
  hooksOff: '⚡ na żywo: wył',
  hooksTitle: 'Aktualizuj świat w chwili, gdy Twoje sesje coś robią (inaczej jest ~1 s opóźnienia)',
  hooksInstall:
    'Włączyć aktualizacje na żywo?\n\nŚwiat będzie reagował w chwili, gdy Twoje sesje Claude Code coś zrobią, zamiast z ~1-sekundowym opóźnieniem. Dopisze to mały wpis do pliku ustawień Claude Code (najpierw powstaje kopia zapasowa). Twoje istniejące ustawienia pozostają nietknięte.',
  hooksUninstall: 'Wyłączyć aktualizacje na żywo? (Twoje pozostałe ustawienia zostają nietknięte)',
  tokensOut: 'Łączna praca wytworzona przez agentów',
  tokensIn: 'Łączna ilość, którą agenci przeczytali',
  connecting: '○ łączenie…',
  missions: 'Zadania',
  states: {
    thinking: 'myśli',
    working: 'pracuje',
    'awaiting-input': 'czeka na Ciebie!',
    idle: 'czeka',
    sleeping: 'śpi',
    error: 'potknięcie',
    returning: 'wraca',
  },
  modelUnknown: 'nieznany model',
  transcriptHint: 'Rozmowa pojawi się tutaj, gdy sesja zacznie coś robić.',
  tok: 'k wytworzono',
  workingNow: 'Pracuje tu teraz',
  sessions: 'sesji',
  peons: 'pomocników',
  tokenUsage: 'Wykonana tu praca',
  today: 'Dziś',
  week: 'Ostatnie 7 dni',
  month: 'Ostatnie 30 dni',
  attribution:
    'Szacowane z aktywności każdej sesji. Pracę przypisujemy do budynku pasującego do tego, co agent robił (liczone w jednostkach tekstu AI).',
  langLabel: 'EN',
  zoomIn: 'Przybliż',
  zoomOut: 'Oddal',
  zoomReset: 'Wycentruj',
  produced: 'Wytworzono',
  read: 'Przeczytano',
  active: 'Aktywny',
  currentTask: 'Bieżące zadanie',
  recentActions: 'Ostatnie akcje',
  now: 'teraz',
  notif: {
    'needs-you': 'agent wzywa pomocy',
    error: 'potknięcie',
    'mission-done': 'zadanie wykonane',
    'new-session': 'nowa sesja',
  },
  notifClose: 'Zamknij',
  notifJump: 'kliknij, by skoczyć',
  autofollow: 'Podążaj',
  autofollowHint: 'Kamera podąża za bohaterem',
  cities: 'MIASTA',
  agents: 'agentów',
  allCities: 'Wszystkie',
  language: 'Język',
  symbols: 'Symbole',
  edges: 'Krawędzie',
  communities: 'Społeczności',
  arsenal: 'Arsenał',
  skills: 'Skille',
  connectors: 'Konektory',
  hooks: 'Hooki',
  subagents: 'Subagenci',
  usedThisSession: 'użyto',
  scanningProject: 'Skanuję projekt…',
  settings: 'Ustawienia',
  buildingReactions: 'Reakcje budynków',
  buildingReactionsHint: 'Wybierz, na jakie narzędzia z żywych logów reaguje każdy budynek. Edytuj wizualnie albo jako JSON poniżej — oba są zsynchronizowane.',
  addTrigger: 'dodaj (, lub ;)',
  kindName: 'nazwa',
  kindPattern: 'wzorzec',
  kindCondition: 'warunek',
  coverage: 'Pokrycie',
  covCovered: 'budynków roboczych pokrytych',
  covUnassigned: 'narzędzi spada do Twierdzy',
  covConflicts: 'konfliktów',
  assign: 'przypisz',
  socialBuildings: 'Budynki socjalne — sterowane stanem sesji, bez wyzwalaczy narzędzi.',
  jsonSynced: 'JSON — synchronizowany z panelem',
  jsonInvalid: 'Niepoprawny config — niezastosowany',
  restoreDefaults: 'Przywróć domyślne',
  addCondition: '+ warunek',
  addPattern: '+ wzorzec',
  toolName: 'narzędzie',
  pattern: 'regex',
  remove: 'Usuń',
  addTriggerConfirm: 'Dodaj wyzwalacz',
};

const IT: UiStrings = {
  fantasy: 'Fantasy',
  scifi: 'Sci-Fi',
  hooksOn: '⚡ live: on',
  hooksOff: '⚡ live: off',
  hooksTitle: "Aggiorna il mondo nell'istante in cui le tue sessioni fanno qualcosa (altrimenti c'è un ritardo di ~1s)",
  hooksInstall:
    "Attivare gli aggiornamenti in tempo reale?\n\nIl mondo reagirà nell'istante in cui le tue sessioni Claude Code faranno qualcosa, invece di avere un ritardo di ~1 secondo. Verrà aggiunta una piccola voce al file delle impostazioni di Claude Code (prima viene salvato un backup). Le tue impostazioni esistenti restano intatte.",
  hooksUninstall: 'Disattivare gli aggiornamenti in tempo reale? (le altre impostazioni restano intatte)',
  tokensOut: 'Lavoro totale prodotto dagli agenti',
  tokensIn: "Quantità totale che gli agenti hanno letto",
  connecting: '○ connessione…',
  missions: 'Missioni',
  states: {
    thinking: 'sta pensando',
    working: 'al lavoro',
    'awaiting-input': 'ti serve!',
    idle: 'in attesa',
    sleeping: 'addormentato',
    error: 'ha incontrato un problema',
    returning: 'sta tornando',
  },
  modelUnknown: 'modello sconosciuto',
  transcriptHint: 'La conversazione apparirà qui quando la sessione inizierà a lavorare.',
  tok: 'k prodotti',
  workingNow: 'Qui si lavora',
  sessions: 'sessioni',
  peons: 'aiutanti',
  tokenUsage: 'Lavoro svolto qui',
  today: 'Oggi',
  week: 'Ultimi 7 giorni',
  month: 'Ultimi 30 giorni',
  attribution:
    "Stimato dall'attività di ogni sessione. Il lavoro è accreditato all'edificio che corrisponde a ciò che l'agente stava facendo (contato nelle unità di testo dell'IA).",
  langLabel: 'PL',
  zoomIn: 'Zoom avanti',
  zoomOut: 'Zoom indietro',
  zoomReset: 'Reimposta vista',
  produced: 'Prodotto',
  read: 'Letto',
  active: 'Attivo',
  currentTask: 'Compito attuale',
  recentActions: 'Azioni recenti',
  now: 'ora',
  notif: {
    'needs-you': 'ha bisogno di te',
    error: 'ha incontrato un problema',
    'mission-done': 'missione completata',
    'new-session': 'nuova sessione',
  },
  notifClose: 'Chiudi',
  notifJump: 'clicca per saltare',
  autofollow: 'Segui',
  autofollowHint: 'La telecamera segue questo eroe',
  cities: 'CITTÀ',
  agents: 'agenti',
  allCities: 'Tutte',
  language: 'Lingua',
  symbols: 'Simboli',
  edges: 'Archi',
  communities: 'Comunità',
  arsenal: 'Arsenale',
  skills: 'Skill',
  connectors: 'Connettori',
  hooks: 'Hook',
  subagents: 'Subagenti',
  usedThisSession: 'usato',
  scanningProject: 'Scansione progetto…',
  settings: 'Impostazioni',
  buildingReactions: 'Reazioni degli edifici',
  buildingReactionsHint: 'Scegli a quali strumenti dei log dal vivo reagisce ogni edificio. Modifica visivamente o come JSON qui sotto — restano sincronizzati.',
  addTrigger: 'aggiungi (, o ;)',
  kindName: 'nome',
  kindPattern: 'pattern',
  kindCondition: 'condizione',
  coverage: 'Copertura',
  covCovered: 'edifici operativi coperti',
  covUnassigned: 'strumenti finiscono al Centro',
  covConflicts: 'conflitti',
  assign: 'assegna',
  socialBuildings: 'Edifici sociali — guidati dallo stato della sessione, senza trigger di strumenti.',
  jsonSynced: 'JSON — sincronizzato con il pannello',
  jsonInvalid: 'Config non valido — non applicato',
  restoreDefaults: 'Ripristina predefiniti',
  addCondition: '+ condizione',
  addPattern: '+ pattern',
  toolName: 'strumento',
  pattern: 'regex',
  remove: 'Rimuovi',
  addTriggerConfirm: 'Aggiungi trigger',
};

const UI: Record<Lang, UiStrings> = { en: EN, pl: PL, it: IT };

/** Reaktywny hook: zwraca napisy UI dla aktualnego języka. */
export function useUi(): UiStrings {
  return UI[useSettings((s) => s.lang)];
}

export interface BuildingText {
  label: string;
  desc: string;
}

type ThemeId = 'fantasy' | 'scifi';

// Opis = co budynek REPREZENTUJE, zwykłym językiem (2 zdania, bez żargonu narzędzi).
const BUILDINGS: Record<ThemeId, Record<BuildingId, Record<Lang, BuildingText>>> = {
  fantasy: {
    citadel: {
      en: {
        label: 'Citadel',
        desc: 'The home base. A session rests here between tasks — planning its next move and thinking things through before heading out to work.',
      },
      pl: {
        label: 'Twierdza',
        desc: 'Baza domowa. Sesja odpoczywa tu między zadaniami — planuje kolejny krok i przemyśliwa sprawy, zanim ruszy do pracy.',
      },
      it: {
        label: 'Cittadella',
        desc: 'La base. Una sessione riposa qui tra un compito e l\'altro — pianifica la prossima mossa e riflette prima di uscire a lavorare.',
      },
    },
    tower: {
      en: {
        label: 'Mage Tower',
        desc: 'The lookout onto the outside world. Agents come here to search the internet and read pages, gathering knowledge that isn’t in your project.',
      },
      pl: {
        label: 'Wieża Maga',
        desc: 'Punkt obserwacyjny świata zewnętrznego. Agenci przychodzą tu przeszukiwać internet i czytać strony, zbierając wiedzę, której nie ma w Twoim projekcie.',
      },
      it: {
        label: 'Torre del Mago',
        desc: 'L\'osservatorio sul mondo esterno. Gli agenti vengono qui per cercare su internet e leggere pagine, raccogliendo conoscenze che non sono nel tuo progetto.',
      },
    },
    forge: {
      en: {
        label: 'Forge',
        desc: 'The workshop. This is where agents actually write and rewrite code — creating new features and fixing what’s broken in your program.',
      },
      pl: {
        label: 'Kuźnia',
        desc: 'Warsztat. To tutaj agenci naprawdę piszą i przerabiają kod — tworzą nowe funkcje i naprawiają to, co nie działa w Twoim programie.',
      },
      it: {
        label: 'Fucina',
        desc: 'L\'officina. È qui che gli agenti scrivono e riscrivono davvero il codice — creando nuove funzionalità e correggendo ciò che non funziona nel tuo programma.',
      },
    },
    library: {
      en: {
        label: 'Library',
        desc: 'The reading room. Agents browse and search through the project’s files here to understand how everything fits together before changing anything.',
      },
      pl: {
        label: 'Biblioteka',
        desc: 'Czytelnia. Agenci przeglądają i przeszukują pliki projektu, by zrozumieć, jak wszystko się łączy, zanim cokolwiek zmienią.',
      },
      it: {
        label: 'Biblioteca',
        desc: 'La sala di lettura. Gli agenti sfogliano e cercano tra i file del progetto per capire come si incastrano i pezzi, prima di cambiare qualcosa.',
      },
    },
    mine: {
      en: {
        label: 'Mine',
        desc: 'The engine room. Agents run commands and tests here — building the project and checking that the work actually runs. The heavy lifting.',
      },
      pl: {
        label: 'Kopalnia',
        desc: 'Maszynownia. Agenci uruchamiają tu polecenia i testy — budują projekt i sprawdzają, czy praca naprawdę działa. Najcięższa robota.',
      },
      it: {
        label: 'Miniera',
        desc: 'La sala macchine. Gli agenti eseguono comandi e test qui — compilano il progetto e verificano che il lavoro funzioni davvero. Il lavoro pesante.',
      },
    },
    barracks: {
      en: {
        label: 'Barracks',
        desc: 'The staging ground. When a job is big, an agent calls in helpers here — smaller assistants that each take on a part of the task at the same time.',
      },
      pl: {
        label: 'Koszary',
        desc: 'Plac zbiórki. Gdy zadanie jest duże, agent wzywa tu pomocników — mniejszych asystentów, z których każdy bierze na siebie część pracy naraz.',
      },
      it: {
        label: 'Caserma',
        desc: 'Il punto di raduno. Quando un lavoro è grande, un agente chiama qui gli aiutanti — assistenti più piccoli che ognuno prende una parte del compito in parallelo.',
      },
    },
    market: {
      en: {
        label: 'Market',
        desc: 'The shipping dock. Finished work leaves from here — saving changes and publishing them so the rest of the team (or the live app) receives them.',
      },
      pl: {
        label: 'Targ',
        desc: 'Nabrzeże wysyłkowe. Stąd wychodzi gotowa praca — zapis zmian i ich publikacja, by trafiły do reszty zespołu (albo do działającej aplikacji).',
      },
      it: {
        label: 'Mercato',
        desc: 'Il molo di spedizione. Da qui parte il lavoro finito — salvataggio delle modifiche e pubblicazione, così il resto del team (o l\'app live) le riceve.',
      },
    },
    guild: {
      en: {
        label: 'Guild',
        desc: 'The connections hub. Agents reach out to outside tools and services here — the plug-ins and integrations that extend what they can do.',
      },
      pl: {
        label: 'Gildia',
        desc: 'Węzeł połączeń. Agenci łączą się tu z zewnętrznymi narzędziami i usługami — wtyczkami i integracjami, które poszerzają ich możliwości.',
      },
      it: {
        label: 'Gilda',
        desc: 'Il nodo delle connessioni. Gli agenti si collegano qui a strumenti e servizi esterni — plugin e integrazioni che estendono ciò che possono fare.',
      },
    },
    arena: {
      en: {
        label: 'Arena',
        desc: 'A gathering ground for active sessions of the same project — they line up here when many work in parallel, so the citadel square doesn’t overflow.',
      },
      pl: {
        label: 'Arena',
        desc: 'Miejsce zbiórki aktywnych sesji tego samego projektu — ustawiają się tu, gdy wiele pracuje równolegle, by plac twierdzy się nie przelewał.',
      },
      it: {
        label: 'Arena',
        desc: 'Punto di raduno per le sessioni attive dello stesso progetto — si mettono in fila qui quando molte lavorano in parallelo, così la piazza della cittadella non trabocca.',
      },
    },
    tavern: {
      en: {
        label: 'Tavern',
        desc: 'A quieter gathering spot for sessions that are waiting or thinking — they rest here with their own project-mates, away from the bustle of the citadel.',
      },
      pl: {
        label: 'Karczma',
        desc: 'Spokojniejsze miejsce zbiórki sesji, które czekają lub myślą — odpoczywają tu ze swoimi współtowarzyszami z projektu, z dala od zgiełku twierdzy.',
      },
      it: {
        label: 'Taverna',
        desc: 'Un punto di ritrovo più tranquillo per le sessioni che aspettano o riflettono — riposano qui con i compagni di progetto, lontano dal trambusto della cittadella.',
      },
    },
    garden: {
      en: {
        label: 'Garden',
        desc: 'A restful spot for sessions that just finished their work — they return here to be with other project-mates who have also wrapped up.',
      },
      pl: {
        label: 'Ogród',
        desc: 'Spokojne miejsce dla sesji, które właśnie skończyły pracę — wracają tu, by być z innymi współtowarzyszami z projektu, którzy też zakończyli.',
      },
      it: {
        label: 'Giardino',
        desc: 'Un angolo tranquillo per le sessioni che hanno appena finito il loro lavoro — tornano qui per stare con gli altri compagni di progetto che hanno concluso.',
      },
    },
    bar: {
      en: {
        label: 'Bar',
        desc: 'A lively social spot for sessions that want to discuss or pair up — they gather here with project-mates to share notes and brainstorm together.',
      },
      pl: {
        label: 'Bar',
        desc: 'Tętniące życiem miejsce towarzyskie dla sesji, które chcą dyskutować lub pracować w parach — zbierają się tu ze współtowarzyszami z projektu, by dzielić się notatkami i burzą mózgów.',
      },
      it: {
        label: 'Bar',
        desc: 'Un punto di ritrovo vivace per le sessioni che vogliono discutere o lavorare in coppia — si radunano qui con i compagni di progetto per condividere appunti e fare brainstorming.',
      },
    },
    shrine: {
      en: {
        label: 'Shrine',
        desc: 'A quiet contemplative spot for sessions deep in thought — they come here to focus alone, away from the bustle of the other gathering places.',
      },
      pl: {
        label: 'Świątynia',
        desc: 'Ciche, kontemplacyjne miejsce dla sesji pogrążonych w myślach — przychodzą tu, by skupić się w samotności, z dala od zgiełku innych punktów zbiórki.',
      },
      it: {
        label: 'Santuario',
        desc: 'Un angolo silenzioso e contemplativo per le sessioni immerse nei loro pensieri — vengono qui per concentrarsi in solitudine, lontano dal trambusto degli altri punti di ritrovo.',
      },
    },
    // I seguenti 3 building esistono solo nel tema sci-fi: in fantasy
    // il type Record<BuildingId, ...> li richiede comunque (etichette
    // placeholder, non vengono mai mostrati).
    holodeck: {
      en: { label: 'Holodeck', desc: 'Sci-fi gathering point.' },
      pl: { label: 'Holodek', desc: 'Punkt zbiórki sci-fi.' },
      it: { label: 'Ologramma', desc: 'Punto di raccolta sci-fi.' },
    },
    mess: {
      en: { label: 'Mess Hall', desc: 'Sci-fi gathering point.' },
      pl: { label: 'Mes', desc: 'Punkt zbiórki sci-fi.' },
      it: { label: 'Mensa', desc: 'Punto di raccolta sci-fi.' },
    },
    hydroponics: {
      en: { label: 'Hydroponics', desc: 'Sci-fi gathering point.' },
      pl: { label: 'Hydroponika', desc: 'Punkt zbiórki sci-fi.' },
      it: { label: 'Idroponica', desc: 'Punto di raccolta sci-fi.' },
    },
    // Anche lounge/medbay sono solo sci-fi (bar/shrine sono nel blocco fantasy sopra).
    lounge: {
      en: { label: 'Lounge', desc: 'Sci-fi gathering point.' },
      pl: { label: 'Salon', desc: 'Punkt zbiórki sci-fi.' },
      it: { label: 'Salotto', desc: 'Punto di raccolta sci-fi.' },
    },
    medbay: {
      en: { label: 'Medbay', desc: 'Sci-fi gathering point.' },
      pl: { label: 'Ambulatorium', desc: 'Punkt zbiórki sci-fi.' },
      it: { label: 'Infermeria', desc: 'Punto di raccolta sci-fi.' },
    },
  },
  scifi: {
    citadel: {
      en: {
        label: 'Command Center',
        desc: 'The home base. A session rests here between tasks — planning its next move and thinking things through before heading out to work.',
      },
      pl: {
        label: 'Centrum dowodzenia',
        desc: 'Baza domowa. Sesja odpoczywa tu między zadaniami — planuje kolejny krok i przemyśliwa sprawy, zanim ruszy do pracy.',
      },
      it: {
        label: 'Centro di Comando',
        desc: 'La base. Una sessione riposa qui tra un compito e l\'altro — pianifica la prossima mossa e riflette prima di uscire a lavorare.',
      },
    },
    tower: {
      en: {
        label: 'Laboratory',
        desc: 'The lookout onto the outside world. Agents come here to search the internet and read pages, gathering knowledge that isn’t in your project.',
      },
      pl: {
        label: 'Laboratorium',
        desc: 'Punkt obserwacyjny świata zewnętrznego. Agenci przychodzą tu przeszukiwać internet i czytać strony, zbierając wiedzę, której nie ma w Twoim projekcie.',
      },
      it: {
        label: 'Laboratorio',
        desc: 'L\'osservatorio sul mondo esterno. Gli agenti vengono qui per cercare su internet e leggere pagine, raccogliendo conoscenze che non sono nel tuo progetto.',
      },
    },
    forge: {
      en: {
        label: 'Drone Factory',
        desc: 'The workshop. This is where agents actually write and rewrite code — creating new features and fixing what’s broken in your program.',
      },
      pl: {
        label: 'Fabryka dronów',
        desc: 'Warsztat. To tutaj agenci naprawdę piszą i przerabiają kod — tworzą nowe funkcje i naprawiają to, co nie działa w Twoim programie.',
      },
      it: {
        label: 'Fabbrica di Droni',
        desc: 'L\'officina. È qui che gli agenti scrivono e riscrivono davvero il codice — creando nuove funzionalità e correggendo ciò che non funziona nel tuo programma.',
      },
    },
    library: {
      en: {
        label: 'Data Archive',
        desc: 'The reading room. Agents browse and search through the project’s files here to understand how everything fits together before changing anything.',
      },
      pl: {
        label: 'Archiwum danych',
        desc: 'Czytelnia. Agenci przeglądają i przeszukują pliki projektu, by zrozumieć, jak wszystko się łączy, zanim cokolwiek zmienią.',
      },
      it: {
        label: 'Archivio Dati',
        desc: 'La sala di lettura. Gli agenti sfogliano e cercano tra i file del progetto per capire come si incastrano i pezzi, prima di cambiare qualcosa.',
      },
    },
    mine: {
      en: {
        label: 'Refinery',
        desc: 'The engine room. Agents run commands and tests here — building the project and checking that the work actually runs. The heavy lifting.',
      },
      pl: {
        label: 'Rafineria',
        desc: 'Maszynownia. Agenci uruchamiają tu polecenia i testy — budują projekt i sprawdzają, czy praca naprawdę działa. Najcięższa robota.',
      },
      it: {
        label: 'Raffineria',
        desc: 'La sala macchine. Gli agenti eseguono comandi e test qui — compilano il progetto e verificano che il lavoro funzioni davvero. Il lavoro pesante.',
      },
    },
    barracks: {
      en: {
        label: 'Hangar',
        desc: 'The staging ground. When a job is big, an agent calls in helpers here — smaller assistants that each take on a part of the task at the same time.',
      },
      pl: {
        label: 'Hangar',
        desc: 'Plac zbiórki. Gdy zadanie jest duże, agent wzywa tu pomocników — mniejszych asystentów, z których każdy bierze na siebie część pracy naraz.',
      },
      it: {
        label: 'Hangar',
        desc: 'Il punto di raduno. Quando un lavoro è grande, un agente chiama qui gli aiutanti — assistenti più piccoli che ognuno prende una parte del compito in parallelo.',
      },
    },
    market: {
      en: {
        label: 'Spaceport',
        desc: 'The shipping dock. Finished work leaves from here — saving changes and publishing them so the rest of the team (or the live app) receives them.',
      },
      pl: {
        label: 'Port kosmiczny',
        desc: 'Nabrzeże wysyłkowe. Stąd wychodzi gotowa praca — zapis zmian i ich publikacja, by trafiły do reszty zespołu (albo do działającej aplikacji).',
      },
      it: {
        label: 'Porto Spaziale',
        desc: 'Il molo di spedizione. Da qui parte il lavoro finito — salvataggio delle modifiche e pubblicazione, così il resto del team (o l\'app live) le riceve.',
      },
    },
    guild: {
      en: {
        label: 'Comms Station',
        desc: 'The connections hub. Agents reach out to outside tools and services here — the plug-ins and integrations that extend what they can do.',
      },
      pl: {
        label: 'Stacja łączności',
        desc: 'Węzeł połączeń. Agenci łączą się tu z zewnętrznymi narzędziami i usługami — wtyczkami i integracjami, które poszerzają ich możliwości.',
      },
      it: {
        label: 'Stazione di Comunicazione',
        desc: 'Il nodo delle connessioni. Gli agenti si collegano qui a strumenti e servizi esterni — plugin e integrazioni che estendono ciò che possono fare.',
      },
    },
    holodeck: {
      en: {
        label: 'Holodeck',
        desc: 'A gathering ground for active sessions of the same project — they line up here when many work in parallel, so the command center doesn’t overflow.',
      },
      pl: {
        label: 'Holodek',
        desc: 'Miejsce zbiórki aktywnych sesji tego samego projektu — ustawiają się tu, gdy wiele pracuje równolegle, by plac centrum dowodzenia się nie przelewał.',
      },
      it: {
        label: 'Ologramma',
        desc: 'Punto di raduno per le sessioni attive dello stesso progetto — si mettono in fila qui quando molte lavorano in parallelo, così la piazza del centro comando non trabocca.',
      },
    },
    mess: {
      en: {
        label: 'Mess Hall',
        desc: 'A quieter gathering spot for sessions that are waiting or thinking — they rest here with their own project-mates, away from the bustle of the command center.',
      },
      pl: {
        label: 'Mes',
        desc: 'Spokojniejsze miejsce zbiórki sesji, które czekają lub myślą — odpoczywają tu ze swoimi współtowarzyszami z projektu, z dala od zgiełku centrum dowodzenia.',
      },
      it: {
        label: 'Mensa',
        desc: 'Un punto di ritrovo più tranquillo per le sessioni che aspettano o riflettono — riposano qui con i compagni di progetto, lontano dal trambusto del centro comando.',
      },
    },
    hydroponics: {
      en: {
        label: 'Hydroponics',
        desc: 'A restful spot for sessions that just finished their work — they return here to be with other project-mates who have also wrapped up.',
      },
      pl: {
        label: 'Hydroponika',
        desc: 'Spokojne miejsce dla sesji, które właśnie skończyły pracę — wracają tu, by być z innymi współtowarzyszami z projektu, którzy też zakończyli.',
      },
      it: {
        label: 'Idroponica',
        desc: 'Un angolo tranquillo per le sessioni che hanno appena finito il loro lavoro — tornano qui per stare con gli altri compagni di progetto che hanno concluso.',
      },
    },
    lounge: {
      en: {
        label: 'Lounge',
        desc: 'A social space for sessions that want to discuss or pair up — they gather here with project-mates to share notes and brainstorm together.',
      },
      pl: {
        label: 'Salon',
        desc: 'Przestrzeń towarzyska dla sesji, które chcą dyskutować lub pracować w parach — zbierają się tu ze współtowarzyszami z projektu, by dzielić się notatkami i burzą mózgów.',
      },
      it: {
        label: 'Salotto',
        desc: 'Uno spazio sociale per le sessioni che vogliono discutere o lavorare in coppia — si radunano qui con i compagni di progetto per condividere appunti e fare brainstorming.',
      },
    },
    medbay: {
      en: {
        label: 'Medbay',
        desc: 'A recovery bay for sessions that hit an error or are stuck — they rest here with project-mates until they’re ready to try again.',
      },
      pl: {
        label: 'Ambulatorium',
        desc: 'Strefa regeneracji dla sesji, które napotkały błąd lub utknęły — odpoczywają tu ze współtowarzyszami z projektu, aż będą gotowe, by spróbować ponownie.',
      },
      it: {
        label: 'Infermeria',
        desc: 'Un\'area di recupero per le sessioni che hanno incontrato un errore o sono bloccate — riposano qui con i compagni di progetto finché non sono pronte a riprovare.',
      },
    },
    // Questi 3 building esistono solo nel tema fantasy: in sci-fi il type
    // Record<BuildingId, ...> li richiede comunque (placeholder, mai mostrati).
    arena: {
      en: { label: 'Arena', desc: 'Fantasy gathering point.' },
      pl: { label: 'Arena', desc: 'Punkt zbiórki fantasy.' },
      it: { label: 'Arena', desc: 'Punto di raccolta fantasy.' },
    },
    tavern: {
      en: { label: 'Tavern', desc: 'Fantasy gathering point.' },
      pl: { label: 'Karczma', desc: 'Punkt zbiórki fantasy.' },
      it: { label: 'Taverna', desc: 'Punto di raccolta fantasy.' },
    },
    garden: {
      en: { label: 'Garden', desc: 'Fantasy gathering point.' },
      pl: { label: 'Ogród', desc: 'Punkt zbiórki fantasy.' },
      it: { label: 'Giardino', desc: 'Punto di raccolta fantasy.' },
    },
    bar: {
      en: { label: 'Bar', desc: 'Fantasy gathering point.' },
      pl: { label: 'Bar', desc: 'Punkt zbiórki fantasy.' },
      it: { label: 'Bar', desc: 'Punto di raccolta fantasy.' },
    },
    shrine: {
      en: { label: 'Shrine', desc: 'Fantasy gathering point.' },
      pl: { label: 'Świątynia', desc: 'Punkt zbiórki fantasy.' },
      it: { label: 'Santuario', desc: 'Punto di raccolta fantasy.' },
    },
  },
};

/** Nazwa + opis budynku dla motywu i języka (z fallbackiem na EN/id). */
export function buildingText(themeId: string, id: BuildingId, lang: Lang): BuildingText {
  const theme = BUILDINGS[themeId as ThemeId] ?? BUILDINGS.fantasy;
  return theme[id]?.[lang] ?? theme[id]?.en ?? { label: id, desc: '' };
}
