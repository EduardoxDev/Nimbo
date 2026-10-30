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
    zhEn: string;
    enZh: string;
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
