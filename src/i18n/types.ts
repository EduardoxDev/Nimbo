export type LocaleCode = "pt-BR" | "en" | "zh-CN";

export type Translations = {
  /** Native language name shown in the locale picker. */
  localeLabel: string;
  /** BCP-47 tag handed to Intl for dates and numbers. */
  localeTag: string;

  common: {
    close: string;
    retry: string;
    refresh: string;
    clear: string;
    saved: string;
    connecting: string;
    noMessages: string;
  };
  messages: {
    collapsedTask: (title: string) => string;
    expand: (label: string) => string;
  };
  translator: {
    label: string;
    title: string;
    subtitle: string;
    settings: string;
    closeLabel: string;
    credentialHint: string;
    secret: string;
    replaceSecret: string;
    enterSecret: string;
    saveSecret: string;
    deleteSecret: string;
    shortcut: string;
    pressShortcut: string;
    shortcutHint: string;
    direction: string;
    auto: string;
    portuguese: string;
    spanish: string;
    chinese: string;
    english: string;
    bilingual: string;
    source: string;
    limit: string;
    placeholder: string;
    paste: string;
    result: string;
    copy: string;
    copied: string;
    clearSource: string;
    loading: string;
    emptyResult: string;
    configureSecret: string;
    enterHint: string;
    translate: string;
    emptyClipboard: string;
    emptySource: string;
    tooLong: string;
    clipboard: (text: string) => string;
  };

  island: {
    appName: string;
    focusing: (taskTitle: string) => string;
    pendingTodos: (count: number) => string;
    openMusic: string;
    collapse: string;
    collapseIsland: string;
    minimizeToTray: string;
    resetPosition: string;
    resetPositionLabel: string;
    editor: string;
    todoList: string;
    music: string;
    clipboardHistory: string;
    layoutEditor: string;
    clipboardTab: string;
    layoutTab: string;
  };

  agent: {
    running: (provider: string) => string;
    failed: (provider: string) => string;
    stale: (provider: string) => string;
    idleOrDone: string;
    phase: {
      running: string;
      completed: string;
      failed: string;
      stale: string;
      idle: string;
    };
  };

  notebook: {
    sectionLabel: string;
    today: string;
    backToToday: string;
    saveToday: string;
    saveTodayMarkdown: string;
    reviewSaved: string;
    tasksTab: string;
    dailyTab: string;
    reviewTab: string;
    openDailyNote: string;
    backToTasks: string;
    notebookCards: string;
    twoColumnTimeline: string;
    openCount: (count: number) => string;
    addTaskFor: (date: string) => string;
    reviewTodos: string;
    addTaskHint: string;
    dailyPlaceholder: string;
    dailyNoteLabel: string;
  };

  archive: {
    noSavedLists: string;
    eyebrow: string;
    noTasks: string;
  };

  music: {
    playerLabel: string;
    controlFailed: string;
    paused: string;
    playing: string;
    noMedia: string;
    previous: string;
    previousTrack: string;
    play: string;
    pause: string;
    next: string;
    nextTrack: string;
    lyrics: string;
    hideLyrics: string;
    loadingLyrics: string;
    noLyrics: string;
    lyricsError: string;
    instrumental: string;
    volume: string;
    mute: string;
    unmute: string;
    seek: string;
    emptyHint: string;
    previousPage: string;
    nextPage: string;
  };

  todo: {
    empty: string;
    emptyReview: string;
    complete: string;
    markIncomplete: string;
    /** Screen-reader label pairing an action with the task it targets. */
    actionOnTask: (action: string, taskTitle: string) => string;
    editTitle: string;
    start: string;
    stop: string;
    delete: string;
    deleteTask: (taskTitle: string) => string;
    reorder: string;
    reorderTask: (taskTitle: string) => string;
  };

  clipboard: {
    title: string;
    favoriteCount: (count: number) => string;
    expandShortcut: string;
    clear: string;
    confirmClear: string;
    clearHistory: string;
    segments: string;
    all: string;
    favorites: string;
    searchPlaceholder: string;
    searchLabel: string;
    clearSearch: string;
    emptyAll: string;
    emptyFavorites: string;
    emptySearch: string;
    copyBack: string;
    copy: string;
    copied: string;
    favorite: string;
    unfavorite: string;
    favoriteItem: string;
    unfavoriteItem: string;
    delete: string;
    confirmDelete: string;
    deleteItem: string;
    notePlaceholder: string;
    noteInputLabel: string;
    saveNote: string;
    cancelEdit: string;
    cancelEditNote: string;
    editNote: (note: string) => string;
    editNoteLabel: string;
    addNote: string;
    addNoteLabel: string;
    noteFallback: string;
  };

  home: {
    title: string;
    connectTitle: string;
    connectHint: string;
    openSettings: string;
    loading: string;
    error: string;
    noDevices: string;
    noDevicesHint: string;
    room: string;
    targetLabel: string;
    decrease: string;
    increase: string;
    switchClimate: string;
    on: string;
    off: string;
    actionFailed: string;
    infrared: string;
    modes: {
      off: string;
      cool: string;
      heat: string;
      heat_cool: string;
      auto: string;
      dry: string;
      fan_only: string;
    };
    actions: {
      off: string;
      cooling: string;
      heating: string;
      idle: string;
      fan: string;
      drying: string;
      preheating: string;
      defrosting: string;
    };
  };
  focus: {
    title: string;
    phases: { focus: string; short: string; long: string };
    headlines: { focus: string; short: string; long: string };
    ended: { focus: string; short: string; long: string };
    paused: string;
    roundOf: (round: number, total: number) => string;
    start: string;
    pause: string;
    resume: string;
    reset: string;
    skip: string;
  };
  water: {
    title: string;
    cupsOf: (cups: number, total: number) => string;
    goalReached: string;
    addCup: (ml: string) => string;
    undo: string;
    remindersOff: string;
    nextReminder: (time: string) => string;
    noMoreReminders: string;
    reminder: string;
    drank: string;
    later: string;
  };
  agents: {
    title: string;
    done: string;
    working: string;
    dismiss: string;
    emptyTitle: string;
    emptyHint: string;
    connect: string;
    addedTask: (agent: string, title: string) => string;
  };
  assistant: {
    title: string;
    placeholder: string;
    send: string;
    newChat: string;
    thinking: string;
    noKey: string;
    noKeyHint: string;
    addKey: string;
    emptyTitle: string;
    suggestion1: string;
    suggestion2: string;
    suggestion3: string;
    suggestion4: string;
    refused: string;
    longConversation: string;
    actions: {
      get_status: string;
      add_task: string;
      complete_task: string;
      focus_timer: string;
      log_water: string;
      music: string;
      air_conditioner: string;
      toggle_device: string;
    };
  };
  welcome: {
    eyebrow: string;
    steps: { title: string; text: string }[];
    skip: string;
    next: string;
    start: string;
  };
  launcher: {
    title: string;
    placeholder: string;
    loading: string;
    hint: string;
    noResults: string;
  };
  shortcuts: {
    section: string;
    hint: string;
    press: string;
    none: string;
    clear: string;
    actions: Record<"toggle" | "playPause" | "nextPage" | "settings" | "launcher", string>;
  };
  weather: {
    section: string;
    city: string;
    cityPlaceholder: string;
    hint: string;
    searching: string;
    noResults: string;
    choose: string;
    remove: string;
    attribution: string;
    range: (max: number, min: number) => string;
    kinds: Record<"clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm", string>;
  };
  calendar: {
    title: string;
    today: string;
    tomorrow: string;
    allDay: string;
    now: string;
    emptyTitle: string;
    emptyHint: string;
    free: string;
    freeHint: string;
    loading: string;
    failed: (names: string) => string;
    startsIn: (title: string, minutes: number) => string;
    ok: string;
  };
  updates: {
    available: (version: string) => string;
    downloading: (percent: number | null) => string;
    install: string;
    later: string;
    check: string;
    checking: string;
    latest: string;
    error: string;
    installVersion: (version: string) => string;
    installHint: string;
  };
  shelf: {
    title: string;
    emptyTitle: string;
    emptyHint: string;
    dropHere: string;
    dropHint: string;
    count: (count: number) => string;
    added: (count: number) => string;
    dragOutHint: string;
    openHint: string;
    reveal: string;
    remove: string;
    clear: string;
    missing: string;
    folder: string;
  };
  prefs: {
    windowTitle: string;
    close: string;
    comingSoon: string;
    pages: {
      general: string;
      statusRing: string;
      display: string;
      appearance: string;
      music: string;
      todo: string;
      calendar: string;
      pomodoro: string;
      water: string;
      home: string;
      shelf: string;
      hud: string;
      agents: string;
      about: string;
    };
    soon: {
      statusRing: string;
      calendar: string;
      pomodoro: string;
      water: string;
      home: string;
      shelf: string;
      hud: string;
    };
    appearance: {
      notchStyle: string;
      classic: string;
      classicHint: string;
      floating: string;
      floatingHint: string;
      glass: string;
      glassHint: string;
      glassTint: string;
      decrease: string;
      increase: string;
      notch: string;
      openNotch: string;
      hover: string;
      click: string;
      pageIcons: string;
      pageIconsHint: string;
      motion: string;
      animationSpeed: string;
      normal: string;
      fast: string;
    };
    general: {
      section: string;
      language: string;
      launchAtStartup: string;
      launchAtStartupHint: string;
      collapsedText: string;
      idleTodoCount: string;
    };
    display: {
      section: string;
      collapsedScale: string;
      expandedScale: string;
      opacity: string;
      marginY: string;
      hideInFullscreen: string;
      hideInFullscreenHint: string;
    };
    music: {
      section: string;
      lyrics: string;
      lyricsHint: string;
      player: string;
      playerHint: string;
    };
    todo: {
      section: string;
      carryOver: string;
      reorder: string;
    };
    home: {
      section: string;
      address: string;
      addressPlaceholder: string;
      token: string;
      tokenPlaceholder: string;
      tokenHint: string;
      connect: string;
      connecting: string;
      connected: string;
      disconnect: string;
      devices: string;
      devicesHint: string;
      noDevices: string;
      privacy: string;
      domains: {
        climate: string;
        light: string;
        switch: string;
        fan: string;
      };
    };
    ir: {
      section: string;
      hint: string;
      search: string;
      searching: string;
      searchAddress: string;
      addressPlaceholder: string;
      noneFound: string;
      use: string;
      device: string;
      change: string;
      brand: string;
      chooseBrand: string;
      model: string;
      useModel: string;
      loadingCatalog: string;
      downloading: string;
      modelLabel: string;
      testOn: string;
      testOff: string;
      testHint: string;
      forget: string;
      step1: string;
      step2: string;
    };
    statusRing: {
      section: string;
      source: string;
      auto: string;
      focus: string;
      water: string;
      none: string;
      hint: string;
    };
    pomodoro: {
      section: string;
      focus: string;
      shortBreak: string;
      longBreak: string;
      rounds: string;
      autoStart: string;
      autoStartHint: string;
      sound: string;
    };
    waterPrefs: {
      section: string;
      goal: string;
      cup: string;
      reminder: string;
      off: string;
    };
    agents: {
      section: string;
      hint: string;
      enabled: string;
      running: string;
      stopped: string;
      address: string;
      token: string;
      show: string;
      hide: string;
      regenerate: string;
      connectSection: string;
      claudeCode: string;
      others: string;
      copy: string;
      copied: string;
      tip: string;
      privacy: string;
    };
    assistant: {
      section: string;
      hint: string;
      key: string;
      keyPlaceholder: string;
      getKey: string;
      save: string;
      saved: string;
      remove: string;
      model: string;
      privacy: string;
    };
    hudPrefs: {
      section: string;
      volume: string;
      volumeHint: string;
      brightness: string;
      brightnessHint: string;
      track: string;
      trackHint: string;
      wheel: string;
      wheelHint: string;
      note: string;
    };
    calendarPrefs: {
      section: string;
      hint: string;
      sources: string;
      name: string;
      namePlaceholder: string;
      url: string;
      urlPlaceholder: string;
      urlHint: string;
      add: string;
      adding: string;
      remove: string;
      reminder: string;
      off: string;
    };
    shelfPrefs: {
      section: string;
      hint: string;
      clear: string;
      cleared: string;
    };
    about: {
      copyDiagnostics: string;
      diagnosticsCopied: string;
      tagline: string;
      version: string;
      basedOn: string;
      github: string;
    };
  };
  settings: {
    messageReception: string;
    title: string;
    reset: string;

    project: {
      title: string;
      star: string;
      starHint: string;
      latestRelease: string;
      latestReleaseHint: string;
      openFailed: string;
    };

    language: {
      title: string;
      label: string;
    };

    appearance: {
      font: string;
      fontLabel: string;
      systemFont: string;
      pixelFont: string;
      title: string;
      classic: string;
      liquidGlass: string;
      glassStrength: string;
    };

    layout: {
      collapsedScale: string;
      expandedScale: string;
      showCollapsedText: string;
      showIdleTodoCount: string;
      title: string;
      opacity: string;
      marginY: string;
      launchAtStartup: string;
      showTitle: string;
    };

    todo: {
      title: string;
      carryOverIncomplete: string;
      enableReorder: string;
    };

    agent: {
      title: string;
      install: string;
      installing: string;
      installed: string;
      currentStatus: string;
      clearStatusFor: (provider: string) => string;
      clearing: string;
      clearStatus: string;
      scriptsDir: string;
    };

    clipboard: {
      title: string;
      enabled: string;
      captureImages: string;
      maxItems: string;
      shortcut: string;
      shortcutEnabled: string;
      pressKeys: string;
    };

    colors: {
      title: string;
      taskText: string;
      pulse: string;
      islandBackground: string;
      todoPaper: string;
      pulseBrightness: string;
    };

    presets: {
      title: string;
      saveCurrent: string;
      empty: string;
      nameLabel: string;
      defaultName: (index: number) => string;
      rename: string;
      defaultPreset: string;
      apply: string;
      delete: string;
      deleteNamed: (name: string) => string;
    };

    save: {
      title: string;
      folder: string;
      folderLabel: string;
      folderPlaceholder: string;
      saved: string;
      save: string;
    };
  };
};
