(() => {
  'use strict';

  // ===========================
  // constants / config
  // ===========================
  const APP_NAME = 'AuraWave';
  const API_BASE = 'https://api.corsproxy.cyou/https://api.deezer.com';
  const API_TIMEOUT = 12000;
  const CACHE_TTL = 1000 * 60 * 5;
  const ICONS = {
    heartOutline: 'https://cdn.jsdelivr.net/npm/heroicons@2.1.3/24/outline/heart.svg',
    heartSolid: 'https://cdn.jsdelivr.net/npm/heroicons@2.1.3/24/solid/heart.svg',
  };
  const STORAGE_KEYS = {
    theme: 'aurawave.theme',
    favorites: 'aurawave.favorites',
    playlists: 'aurawave.playlists',
    recently: 'aurawave.recently',
    queue: 'aurawave.queue',
  };

  // ===========================
  // utilities
  // ===========================
  const $ = (sel, parent = document) => parent.querySelector(sel);
  const $$ = (sel, parent = document) => Array.from(parent.querySelectorAll(sel));

  const debounce = (fn, wait = 300) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  };

  const formatTime = (sec) => {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  };

  const encodeParams = (params) => {
    const sp = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') sp.set(k, v);
    });
    return sp.toString();
  };

  const safeJson = async (res) => {
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { error: { message: text } }; }
  };

  const showToast = (message) => {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2200);
  };

  const likeIconMarkup = (liked) => `
    <img class="icon-svg" src="${liked ? ICONS.heartSolid : ICONS.heartOutline}" alt="" aria-hidden="true" />
  `;

  const setLikeIcon = (button, liked) => {
    if (!button) return;
    const icon = button.querySelector('.icon-svg');
    if (icon) icon.src = liked ? ICONS.heartSolid : ICONS.heartOutline;
    button.classList.toggle('is-liked', liked);
  };

  const modal = {
    open(html) {
      const root = $('#modalRoot');
      root.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
      root.classList.add('active');
      root.setAttribute('aria-hidden', 'false');
      root.addEventListener('click', (e) => {
        if (e.target === root) modal.close();
      }, { once: true });
    },
    close() {
      const root = $('#modalRoot');
      root.classList.remove('active');
      root.setAttribute('aria-hidden', 'true');
      root.innerHTML = '';
    },
  };

  const persist = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    },
  };

  // ===========================
  // state / store
  // ===========================
  const store = {
    state: {
      theme: persist.get(STORAGE_KEYS.theme, 'dark'),
      route: { name: 'home', params: {} },
      search: { q: '', type: 'track', results: null, loading: false, error: null },
      charts: null,
      library: {
        favorites: persist.get(STORAGE_KEYS.favorites, []),
        playlists: persist.get(STORAGE_KEYS.playlists, []),
      },
      recently: persist.get(STORAGE_KEYS.recently, []),
      queue: persist.get(STORAGE_KEYS.queue, []),
      currentIndex: 0,
      playing: false,
      shuffle: false,
      repeat: 'off', // off | track | queue
      loading: false,
      error: null,
    },
    listeners: new Map(),
    set(partial) {
      this.state = { ...this.state, ...partial };
      this.emit();
    },
    update(fn) {
      this.state = fn({ ...this.state });
      this.emit();
    },
    on(fn) {
      const id = Math.random().toString(36).slice(2);
      this.listeners.set(id, fn);
      return () => this.listeners.delete(id);
    },
    emit() {
      this.listeners.forEach((fn) => fn(this.state));
    },
  };

  // ===========================
  // api client
  // ===========================
  const cache = new Map();

  const apiFetch = async (path, params = {}) => {
    const qs = encodeParams(params);
    const url = `${API_BASE}${path}${qs ? `?${qs}` : ''}`;
    const now = Date.now();
    const cached = cache.get(url);
    if (cached && now - cached.ts < CACHE_TTL) return cached.data;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);
    try {
      const res = await fetch(url, { signal: controller.signal });
      const data = await safeJson(res);
      if (!res.ok || data?.error) {
        const msg = data?.error?.message || `Request failed (${res.status})`;
        throw new Error(msg);
      }
      cache.set(url, { ts: now, data });
      return data;
    } finally {
      clearTimeout(timeout);
    }
  };

  const api = {
    search(query, type = 'track') {
      const endpoint = type === 'artist' ? '/search/artist' : type === 'album' ? '/search/album' : '/search';
      return apiFetch(endpoint, { q: query });
    },
    searchArtist(query, limit = 1) {
      return apiFetch('/search/artist', { q: query, limit });
    },
    searchAlbums(query, limit = 12) {
      return apiFetch('/search/album', { q: query, limit });
    },
    getCharts() {
      return apiFetch('/chart');
    },
    getTrack(id) {
      return apiFetch(`/track/${encodeURIComponent(id)}`);
    },
    getAlbum(id) {
      return apiFetch(`/album/${encodeURIComponent(id)}`);
    },
    getArtist(id) {
      return apiFetch(`/artist/${encodeURIComponent(id)}`);
    },
    getArtistTopTracks(id) {
      return apiFetch(`/artist/${encodeURIComponent(id)}/top`, { limit: 10 });
    },
    getArtistAlbums(id, limit = 12) {
      return apiFetch(`/artist/${encodeURIComponent(id)}/albums`, { limit });
    },
    getPlaylist(id) {
      return apiFetch(`/playlist/${encodeURIComponent(id)}`);
    },
  };

  // ===========================
  // player logic
  // ===========================
  const audio = new Audio();
  audio.preload = 'metadata';
  audio.volume = 0.8;

  const setQueue = (tracks, index = 0) => {
    store.update((s) => ({ ...s, queue: tracks, currentIndex: index }));
    persist.set(STORAGE_KEYS.queue, tracks);
  };

  const currentTrack = () => store.state.queue[store.state.currentIndex];

  const playTrack = (track, queue = null, index = 0) => {
    if (!track?.preview) {
      showToast('Preview unavailable for this track');
      return;
    }
    if (queue) setQueue(queue, index);
    audio.src = track.preview;
    audio.play();
    store.update((s) => ({ ...s, playing: true }));
    addRecently(track);
    renderPlayer();
  };

  const togglePlay = () => {
    if (!currentTrack()) return;
    if (audio.paused) {
      audio.play();
      store.update((s) => ({ ...s, playing: true }));
    } else {
      audio.pause();
      store.update((s) => ({ ...s, playing: false }));
    }
    renderPlayer();
  };

  const nextTrack = () => {
    const { queue, currentIndex, repeat, shuffle } = store.state;
    if (!queue.length) return;
    if (repeat === 'track') {
      audio.currentTime = 0;
      audio.play();
      return;
    }
    let next = currentIndex + 1;
    if (shuffle) next = Math.floor(Math.random() * queue.length);
    if (next >= queue.length) {
      if (repeat === 'queue') next = 0;
      else {
        store.update((s) => ({ ...s, playing: false }));
        return;
      }
    }
    store.update((s) => ({ ...s, currentIndex: next }));
    playTrack(queue[next]);
  };

  const prevTrack = () => {
    const { queue, currentIndex } = store.state;
    if (!queue.length) return;
    let prev = currentIndex - 1;
    if (prev < 0) prev = 0;
    store.update((s) => ({ ...s, currentIndex: prev }));
    playTrack(queue[prev]);
  };

  audio.addEventListener('ended', () => nextTrack());
  audio.addEventListener('timeupdate', () => {
    const seek = $('#miniSeek');
    const elapsed = $('#miniElapsed');
    const remaining = $('#miniRemaining');
    if (!seek || !elapsed || !remaining) return;
    seek.value = Math.min(30, Math.floor(audio.currentTime));
    elapsed.textContent = formatTime(audio.currentTime);
    remaining.textContent = formatTime(30 - audio.currentTime);
  });

  // ===========================
  // library logic
  // ===========================
  const isFavorite = (id) => store.state.library.favorites.some((t) => t.id === id);

  const toggleFavorite = (track) => {
    store.update((s) => {
      const exists = s.library.favorites.some((t) => t.id === track.id);
      const favorites = exists
        ? s.library.favorites.filter((t) => t.id !== track.id)
        : [track, ...s.library.favorites];
      persist.set(STORAGE_KEYS.favorites, favorites);
      return { ...s, library: { ...s.library, favorites } };
    });
    showToast(isFavorite(track.id) ? 'Added to favorites' : 'Removed from favorites');
  };

  const addRecently = (track) => {
    store.update((s) => {
      const filtered = s.recently.filter((t) => t.id !== track.id);
      const next = [track, ...filtered].slice(0, 20);
      persist.set(STORAGE_KEYS.recently, next);
      return { ...s, recently: next };
    });
  };

  const createPlaylist = (name, tracks = []) => {
    const playlist = { id: `pl_${Date.now()}`, name, tracks };
    store.update((s) => {
      const playlists = [playlist, ...s.library.playlists];
      persist.set(STORAGE_KEYS.playlists, playlists);
      return { ...s, library: { ...s.library, playlists } };
    });
    showToast('Playlist created');
  };

  const renamePlaylist = (id, name) => {
    store.update((s) => {
      const playlists = s.library.playlists.map((p) => (p.id === id ? { ...p, name } : p));
      persist.set(STORAGE_KEYS.playlists, playlists);
      return { ...s, library: { ...s.library, playlists } };
    });
    showToast('Playlist renamed');
  };

  const deletePlaylist = (id) => {
    store.update((s) => {
      const playlists = s.library.playlists.filter((p) => p.id !== id);
      persist.set(STORAGE_KEYS.playlists, playlists);
      return { ...s, library: { ...s.library, playlists } };
    });
    showToast('Playlist deleted');
  };

  const addToPlaylist = (playlistId, track) => {
    store.update((s) => {
      const playlists = s.library.playlists.map((p) => {
        if (p.id !== playlistId) return p;
        if (p.tracks.some((t) => t.id === track.id)) return p;
        return { ...p, tracks: [track, ...p.tracks] };
      });
      persist.set(STORAGE_KEYS.playlists, playlists);
      return { ...s, library: { ...s.library, playlists } };
    });
    showToast('Added to playlist');
  };

  const removeFromPlaylist = (playlistId, trackId) => {
    store.update((s) => {
      const playlists = s.library.playlists.map((p) => {
        if (p.id !== playlistId) return p;
        return { ...p, tracks: p.tracks.filter((t) => t.id !== trackId) };
      });
      persist.set(STORAGE_KEYS.playlists, playlists);
      return { ...s, library: { ...s.library, playlists } };
    });
    showToast('Removed from playlist');
  };

  // ===========================
  // router
  // ===========================
  const parseRoute = () => {
    const hash = window.location.hash || '#/home';
    const [path, queryString] = hash.split('?');
    const parts = path.replace('#/', '').split('/');
    const params = Object.fromEntries(new URLSearchParams(queryString || ''));
    return { name: parts[0] || 'home', id: parts[1], params };
  };

  const navigate = () => {
    const route = parseRoute();
    store.update((s) => {
      const next = { ...s, route };
      if (route.name === 'search' && route.params?.q) {
        next.search = { ...s.search, q: route.params.q };
      }
      return next;
    });
    renderView();
    setActiveNav(route.name);
  };

  const setActiveNav = (name) => {
    $$('[data-route]').forEach((el) => {
      if (el.dataset.route === name) el.classList.add('active');
      else el.classList.remove('active');
    });
  };

  // ===========================
  // renderers / components
  // ===========================
  const trackRegistry = new Map();

  const registerTrack = (track) => {
    if (!track?.id) return;
    trackRegistry.set(String(track.id), track);
  };

  const renderSkeletons = (count = 4) => {
    return `<div class="cards">${Array.from({ length: count }).map(() => '<div class="skeleton"></div>').join('')}</div>`;
  };

  const TrackRow = (track, options = {}) => {
    registerTrack(track);
    const like = isFavorite(track.id);
    const actions = `
      <div class="track-actions">
        <button class="btn icon" data-action="play" aria-label="Play">▶</button>
        <button class="btn icon ${like ? 'is-liked' : ''}" data-action="like" aria-label="Like">${likeIconMarkup(like)}</button>
        <button class="btn icon" data-action="add" aria-label="Add to playlist">＋</button>
      </div>`;
    return `
      <div class="track-row" data-track-id="${track.id}">
        <img class="cover" src="${track.album?.cover_medium || track.album?.cover || ''}" alt="${track.title}" />
        <div class="track-meta">
          <div class="track-title">${track.title}</div>
          <div class="track-sub">${track.artist?.name || 'Unknown'} • ${track.album?.title || ''}</div>
        </div>
        ${options.noActions ? '' : actions}
      </div>`;
  };

  const AlbumCard = (album) => `
    <div class="card" data-action="album" data-id="${album.id}">
      <img src="${album.cover_medium || album.cover || ''}" alt="${album.title}" />
      <div class="card-title">${album.title}</div>
      <div class="card-sub">${album.artist?.name || ''}</div>
    </div>`;

  const ArtistCard = (artist) => `
    <div class="card" data-action="artist" data-id="${artist.id}">
      <img src="${artist.picture_medium || artist.picture || ''}" alt="${artist.name}" />
      <div class="card-title">${artist.name}</div>
      <div class="card-sub">Artist</div>
    </div>`;

  const emptyState = (title, sub) => `
    <div class="card">
      <div class="card-title">${title}</div>
      <div class="card-sub">${sub}</div>
    </div>`;

  const UZBEK_ARTISTS = [
    'Ummon',
    'Shoxrux',
    'Shahzoda',
    'Rayhon',
    'Lola',
    'Yulduz Usmonova',
    'Munisa Rizayeva',
    'Ulugbek Rahmatullayev',
    'Asal Shodieva',
    'Jaloliddin Ahmadaliyev',
  ];

  const getUzbekHighlights = async () => {
    const artistSearches = await Promise.all(
      UZBEK_ARTISTS.map((name) => api.searchArtist(name, 1).catch(() => null))
    );
    const artists = artistSearches.map((r) => r?.data?.[0]).filter(Boolean);
    const [tracksRes, albumsRes] = await Promise.all([
      Promise.all(artists.map((a) => api.getArtistTopTracks(a.id).catch(() => ({ data: [] })))),
      Promise.all(artists.map((a) => api.getArtistAlbums(a.id, 8).catch(() => ({ data: [] })))),
    ]);
    const tracks = Array.from(
      new Map(tracksRes.flatMap((r) => r.data || []).map((t) => [t.id, t])).values()
    ).slice(0, 12);
    const albums = Array.from(
      new Map(albumsRes.flatMap((r) => r.data || []).map((a) => [a.id, a])).values()
    ).slice(0, 12);
    return { artists, tracks, albums };
  };

  // ===========================
  // views
  // ===========================
  const renderHome = async () => {
    const view = $('#view');
    view.innerHTML = `
      <section class="hero" id="hero">
        <div class="hero-overlay"></div>
        <div class="hero-content">
          <h1 class="hero-title">O'zbek Mix</h1>
          <p class="hero-sub">Eng mashhur o'zbek qo'shiqlar to'plami.</p>
          <div class="hero-actions">
            <button class="btn" id="heroPlay">Tinglash</button>
          </div>
        </div>
      </section>

      <section class="section">
        <h2>Trending Now</h2>
        <div id="chartsTracks">${renderSkeletons(4)}</div>
      </section>
      <section class="section">
        <h2>Uzbek Albums</h2>
        <div id="chartsAlbums">${renderSkeletons(4)}</div>
      </section>
      <section class="section">
        <h2>Top Artists</h2>
        <div id="chartsArtists">${renderSkeletons(4)}</div>
      </section>
      </section>`;

    try {
      const [charts, uzbek] = await Promise.all([
        api.getCharts(),
        getUzbekHighlights(),
      ]);
      store.update((s) => ({ ...s, charts }));
      const hero = $('#hero');
      const heroPlay = $('#heroPlay');
      const heroShuffle = $('#heroShuffle');
      const heroFavorite = $('#heroFavorite');
      const uzbekQueue = uzbek.tracks.length ? uzbek.tracks : charts.tracks.data.slice(0, 20);
      const heroTrack = uzbekQueue[Math.floor(Math.random() * uzbekQueue.length)] || charts.tracks.data[0];
      const heroAlbumCover = uzbek.albums[0]?.cover_xl || uzbek.albums[0]?.cover_big || heroTrack?.album?.cover_xl;
      // if (hero && heroAlbumCover) {
      //   hero.style.backgroundImage = `url(${heroAlbumCover})`;
      // }
      if (heroPlay && heroTrack) {
        heroPlay.onclick = () => {
          const randomTrack = uzbekQueue[Math.floor(Math.random() * uzbekQueue.length)];
          playTrack(randomTrack, uzbekQueue, uzbekQueue.indexOf(randomTrack));
        };
      }
      if (heroShuffle && heroTrack) {
        heroShuffle.onclick = () => {
          const queue = [...uzbekQueue].sort(() => Math.random() - 0.5);
          playTrack(queue[0], queue, 0);
        };
      }
      if (heroFavorite && heroTrack) {
        heroFavorite.onclick = () => toggleFavorite(heroTrack);
      }
      $('#chartsTracks').innerHTML = `<div class="tracks">${uzbek.tracks.length ? uzbek.tracks.map((t) => TrackRow(t)).join('') : charts.tracks.data.slice(0, 6).map((t) => TrackRow(t)).join('')}</div>`;
      $('#chartsAlbums').innerHTML = uzbek.albums.length
        ? `<div class="cards">${uzbek.albums.map(AlbumCard).join('')}</div>`
        : emptyState('No Uzbek albums found', 'Try search for a specific artist or album.');
      $('#chartsArtists').innerHTML = `<div class="cards">${uzbek.artists.length ? uzbek.artists.map(ArtistCard).join('') : charts.artists.data.slice(0, 6).map(ArtistCard).join('')}</div>`;
      bindTrackRowActions($('#chartsTracks'));
      bindCardActions($('#chartsAlbums'));
      bindCardActions($('#chartsArtists'));
    } catch (err) {
      $('#chartsTracks').innerHTML = emptyState('Unable to load charts', err.message || '');
      $('#chartsAlbums').innerHTML = emptyState('Unable to load Uzbek albums', err.message || '');
      $('#chartsArtists').innerHTML = '';
      showCORSMessage(err);
    }
  };

  const renderSearch = async () => {
    const { q, type, results, loading } = store.state.search;
    const view = $('#view');
    view.innerHTML = `
      <section class="section">
        <h2>Search</h2>
        <div class="search-input">
          <span class="search-icon" aria-hidden="true">
            <img class="icon-svg" src="https://cdn.jsdelivr.net/npm/heroicons@2.1.3/24/outline/magnifying-glass.svg" alt="" />
          </span>
          <input class="input" id="searchInput" placeholder="Search tracks, artists, albums" value="${q}" aria-label="Search" />
        </div>
        <div class="filters">
          ${['track', 'artist', 'album'].map((t) => `<button class="filter-btn ${type === t ? 'active' : ''}" data-type="${t}">${t}</button>`).join('')}
        </div>
        <div id="searchRecommend"></div>
        <div id="searchResults">${loading ? renderSkeletons(6) : ''}</div>
      </section>`;

    const input = $('#searchInput');
    input.focus();
    input.addEventListener('input', debounce((e) => {
      const value = e.target.value.trim();
      store.update((s) => ({ ...s, search: { ...s.search, q: value } }));
      if (value.length > 1) executeSearch(value, store.state.search.type);
      else $('#searchResults').innerHTML = emptyState('Type to search', 'Start with at least 2 characters.');
    }, 450));

    $$('.filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.type;
        store.update((s) => ({ ...s, search: { ...s.search, type: t } }));
        if (store.state.search.q.length > 1) executeSearch(store.state.search.q, t);
        renderSearch();
      });
    });

    if (!q) {
      $('#searchResults').innerHTML = emptyState('Discover your vibe', 'Search for tracks, artists, and albums.');
      renderSearchRecommendations();
      return;
    }

    if (!results && !loading) {
      executeSearch(q, type);
      return;
    }

    if (results && !loading) {
      renderSearchResults(results, type);
    }
  };

  const renderSearchRecommendations = async () => {
    const target = $('#searchRecommend');
    if (!target) return;
    target.innerHTML = `
      <div class="section-head">
        <h3>Recommended for you</h3>
        <span class="meta-small">Based on Uzbek picks + charts</span>
      </div>
      ${renderSkeletons(4)}`;
    try {
      const [charts, uzbek] = await Promise.all([
        api.getCharts(),
        getUzbekHighlights(),
      ]);
      const recTracks = (uzbek.tracks.length ? uzbek.tracks : charts.tracks.data).slice(0, 6);
      const recArtists = (uzbek.artists.length ? uzbek.artists : charts.artists.data).slice(0, 6);
      target.innerHTML = `
        <div class="recommend-block">
          <div class="recommend-title">Top Tracks</div>
          <div class="tracks">${recTracks.map((t) => TrackRow(t)).join('')}</div>
        </div>
        <div class="recommend-block">
          <div class="recommend-title">Artists to follow</div>
          <div class="cards">${recArtists.map(ArtistCard).join('')}</div>
        </div>`;
      bindTrackRowActions(target);
      bindCardActions(target);
    } catch (err) {
      target.innerHTML = emptyState('Recommendations unavailable', err.message || '');
      showCORSMessage(err);
    }
  };

  const renderSearchResults = (results, type) => {
    const target = $('#searchResults');
    if (!results?.data?.length) {
      target.innerHTML = emptyState('No results', 'Try a different search.');
      return;
    }
    if (type === 'artist') {
      target.innerHTML = `<div class="cards">${results.data.map(ArtistCard).join('')}</div>`;
      bindCardActions(target);
      return;
    }
    if (type === 'album') {
      target.innerHTML = `<div class="cards">${results.data.map(AlbumCard).join('')}</div>`;
      bindCardActions(target);
      return;
    }
    target.innerHTML = `<div class="tracks">${results.data.map((t) => TrackRow(t)).join('')}</div>`;
    bindTrackRowActions(target);
  };

  const renderLibrary = () => {
    const { favorites, playlists } = store.state.library;
    const view = $('#view');
    view.innerHTML = `
      <section class="section">
        <div class="section-head">
          <h2>Your Library</h2>
          <button class="btn" id="createPlaylist">New Playlist</button>
        </div>
      </section>
      <section class="section">
        <h3>Favorites</h3>
        <div id="favList"></div>
      </section>
      <section class="section">
        <h3>Playlists</h3>
        <div id="playlistList"></div>
      </section>`;

    $('#favList').innerHTML = favorites.length
      ? `<div class="tracks">${favorites.map((t) => TrackRow(t)).join('')}</div>`
      : emptyState('No favorites yet', 'Tap the heart on a track.');
    bindTrackRowActions($('#favList'));

    $('#playlistList').innerHTML = playlists.length
      ? `<div class="cards">${playlists.map((p) => `
          <div class="card" data-action="playlist" data-id="${p.id}">
            <div class="cover"></div>
            <div class="card-title">${p.name}</div>
            <div class="card-sub">${p.tracks.length} tracks</div>
          </div>`).join('')}</div>`
      : emptyState('No playlists yet', 'Create a playlist to organize tracks.');

    bindCardActions($('#playlistList'));

    $('#createPlaylist').addEventListener('click', () => openPlaylistModal());
  };

  const renderFavorites = () => {
    const { favorites } = store.state.library;
    const view = $('#view');
    view.innerHTML = `
      <section class="section">
        <h2>My Favorites</h2>
      </section>
      <section class="section">
        <div id="favView"></div>
      </section>`;
    $('#favView').innerHTML = favorites.length
      ? `<div class="tracks">${favorites.map((t) => TrackRow(t)).join('')}</div>`
      : emptyState('No favorites yet', 'Tap the heart on a track.');
    bindTrackRowActions($('#favView'));
  };

  const renderHistory = () => {
    const view = $('#view');
    const recently = store.state.recently;
    view.innerHTML = `
      <section class="section">
        <h2>History</h2>
      </section>
      <section class="section">
        <div id="historyView"></div>
      </section>`;
    $('#historyView').innerHTML = recently.length
      ? `<div class="tracks">${recently.map((t) => TrackRow(t)).join('')}</div>`
      : emptyState('No recent plays', 'Play a track to see it here.');
    bindTrackRowActions($('#historyView'));
  };

  const renderArtist = async (id) => {
    const view = $('#view');
    view.innerHTML = renderSkeletons(6);
    try {
      const [artist, top, albums] = await Promise.all([
        api.getArtist(id),
        api.getArtistTopTracks(id),
        api.getArtistAlbums(id),
      ]);
      view.innerHTML = `
        <section class="section">
          <h2>${artist.name}</h2>
          <div class="card-sub">${artist.nb_fan?.toLocaleString() || ''} fans</div>
        </section>
        <section class="section">
          <h3>Top Tracks</h3>
          <div class="tracks">${top.data.map((t) => TrackRow(t)).join('')}</div>
        </section>
        <section class="section">
          <h3>Albums</h3>
          <div class="cards">${albums.data.map(AlbumCard).join('')}</div>
        </section>`;
      bindTrackRowActions(view);
      bindCardActions(view);
    } catch (err) {
      view.innerHTML = emptyState('Artist unavailable', err.message || '');
      showCORSMessage(err);
    }
  };

  const renderAlbum = async (id) => {
    const view = $('#view');
    view.innerHTML = renderSkeletons(6);
    try {
      const album = await api.getAlbum(id);
      view.innerHTML = `
        <section class="section">
          <h2>${album.title}</h2>
          <div class="card-sub">${album.artist?.name || ''} • ${album.release_date || ''}</div>
        </section>
        <section class="section">
          <h3>Tracks</h3>
          <div class="tracks">${album.tracks.data.map((t) => TrackRow({ ...t, album })).join('')}</div>
        </section>`;
      bindTrackRowActions(view);
    } catch (err) {
      view.innerHTML = emptyState('Album unavailable', err.message || '');
      showCORSMessage(err);
    }
  };

  const renderTrack = async (id) => {
    const view = $('#view');
    view.innerHTML = renderSkeletons(4);
    try {
      const track = await api.getTrack(id);
      view.innerHTML = `
        <section class="section">
          <h2>${track.title}</h2>
          <div class="card-sub">${track.artist?.name || ''} • ${track.album?.title || ''}</div>
        </section>
        <section class="section">
          <div class="tracks">${TrackRow(track)}</div>
        </section>`;
      bindTrackRowActions(view);
    } catch (err) {
      view.innerHTML = emptyState('Track unavailable', err.message || '');
      showCORSMessage(err);
    }
  };

  const renderPlaylist = (id) => {
    const view = $('#view');
    const playlist = store.state.library.playlists.find((p) => p.id === id);
    if (!playlist) {
      view.innerHTML = emptyState('Playlist not found', '');
      return;
    }
    view.innerHTML = `
      <section class="section">
        <div class="section-head">
          <h2>${playlist.name}</h2>
          <div>
            <button class="btn ghost" id="renamePlaylist">Rename</button>
            <button class="btn ghost" id="deletePlaylist">Delete</button>
          </div>
        </div>
      </section>
      <section class="section">
        <div class="tracks">${playlist.tracks.map((t) => TrackRow(t)).join('')}</div>
      </section>`;
    bindTrackRowActions(view, { playlistId: playlist.id });
    $('#renamePlaylist').addEventListener('click', () => openPlaylistModal(playlist));
    $('#deletePlaylist').addEventListener('click', () => deletePlaylist(playlist.id));
  };

  const renderView = () => {
    const { route } = store.state;
    if (!route) return;
    if (route.name === 'home') return renderHome();
    if (route.name === 'search') return renderSearch();
    if (route.name === 'library') return renderLibrary();
    if (route.name === 'favorites') return renderFavorites();
    if (route.name === 'history') return renderHistory();
    if (route.name === 'artist') return renderArtist(route.id);
    if (route.name === 'album') return renderAlbum(route.id);
    if (route.name === 'track') return renderTrack(route.id);
    if (route.name === 'playlist') return renderPlaylist(route.id);
    return renderHome();
  };

  // ===========================
  // search logic
  // ===========================
  const executeSearch = async (query, type) => {
    const q = (query || '').trim();
    if (q.length < 2) {
      store.update((s) => ({ ...s, search: { ...s.search, loading: false, results: null, error: null } }));
      const target = $('#searchResults');
      if (target) target.innerHTML = emptyState('Type to search', 'Start with at least 2 characters.');
      return;
    }
    store.update((s) => ({ ...s, search: { ...s.search, loading: true, error: null } }));
    try {
      const results = await api.search(q, type);
      store.update((s) => ({ ...s, search: { ...s.search, results, loading: false } }));
      renderSearchResults(results, type);
    } catch (err) {
      store.update((s) => ({ ...s, search: { ...s.search, loading: false, error: err.message } }));
      $('#searchResults').innerHTML = emptyState('Search failed', err.message || '');
      showCORSMessage(err);
    }
  };

  // ===========================
  // player rendering
  // ===========================
  const renderPlayer = () => {
    const track = currentTrack();
    const miniTitle = $('#miniTitle');
    const miniArtist = $('#miniArtist');
    const miniCover = $('#miniCover');
    const player = $('.player');
    const expandedCover = $('#expandedCover');
    const expandedTitle = $('#expandedTitle');
    const expandedArtist = $('#expandedArtist');
    const expandedAlbum = $('#expandedAlbum');
    const expandedPreview = $('#expandedPreview');
    const playIcons = ['#miniPlay', '#btnPlay'];

    playIcons.forEach((sel) => {
      const btn = $(sel);
      if (btn) btn.textContent = store.state.playing ? '⏸' : '⏵';
    });

    if (!track) {
      if (miniTitle) miniTitle.textContent = 'Nothing playing';
      if (miniArtist) miniArtist.textContent = 'Pick a track';
      if (miniCover) miniCover.style.backgroundImage = '';
      if (player) player.style.backgroundImage = '';
      if (expandedCover) expandedCover.style.backgroundImage = '';
      if (expandedTitle) expandedTitle.textContent = 'Select a track';
      if (expandedArtist) expandedArtist.textContent = '—';
      if (expandedAlbum) expandedAlbum.textContent = '—';
      if (expandedPreview) expandedPreview.textContent = 'Preview';
      return;
    }

    if (miniTitle) miniTitle.textContent = track.title;
    if (miniArtist) miniArtist.textContent = track.artist?.name || 'Unknown';
    const cover = track.album?.cover_medium || track.album?.cover || '';
    if (miniCover) miniCover.style.backgroundImage = cover ? `url(${cover})` : '';
    const favBtn = $('#miniFav');
    if (favBtn) {
      const liked = isFavorite(track.id);
      setLikeIcon(favBtn, liked);
    }
    if (player) player.style.backgroundImage = '';
    if (expandedCover) expandedCover.style.backgroundImage = cover ? `url(${cover})` : '';
    if (expandedTitle) expandedTitle.textContent = track.title;
    if (expandedArtist) expandedArtist.textContent = track.artist?.name || 'Unknown';
    if (expandedAlbum) expandedAlbum.textContent = track.album?.title || '';
    if (expandedPreview) expandedPreview.textContent = 'Preview • 30s';
  };

  const bindPlayerControls = () => {
    const on = (sel, ev, fn) => {
      const el = $(sel);
      if (el) el.addEventListener(ev, fn);
    };

    on('#miniPlay', 'click', togglePlay);
    on('#miniPrev', 'click', prevTrack);
    on('#miniNext', 'click', nextTrack);
    on('#miniShuffle', 'click', () => {
      store.update((s) => ({ ...s, shuffle: !s.shuffle }));
      showToast(store.state.shuffle ? 'Shuffle on' : 'Shuffle off');
    });
    on('#miniFav', 'click', () => {
      const track = currentTrack();
      if (!track) return;
      toggleFavorite(track);
      renderPlayer();
    });
    on('#btnPlay', 'click', togglePlay);
    on('#btnPrev', 'click', prevTrack);
    on('#btnNext', 'click', nextTrack);

    on('#btnShuffle', 'click', () => {
      store.update((s) => ({ ...s, shuffle: !s.shuffle }));
      showToast(store.state.shuffle ? 'Shuffle on' : 'Shuffle off');
    });

    on('#btnRepeat', 'click', () => {
      const next = store.state.repeat === 'off' ? 'queue' : store.state.repeat === 'queue' ? 'track' : 'off';
      store.update((s) => ({ ...s, repeat: next }));
      showToast(`Repeat ${next}`);
    });

    on('#miniSeek', 'input', (e) => {
      audio.currentTime = Number(e.target.value);
    });

    on('#clearQueue', 'click', () => {
      setQueue([], 0);
      renderQueue();
      renderPlayer();
      showToast('Queue cleared');
    });
  };

  const renderQueue = () => {
    const list = $('#queueList');
    if (!list) return;
    const { queue, currentIndex } = store.state;
    if (!queue.length) {
      list.innerHTML = '<div class="small">Queue is empty</div>';
      return;
    }
    list.innerHTML = queue.map((t, idx) => `
      <div class="queue-item" draggable="true" data-index="${idx}">
        ${idx === currentIndex ? '▶ ' : ''}${t.title} • ${t.artist?.name || ''}
      </div>`).join('');

    bindQueueDnD(list);
  };

  const bindQueueDnD = (container) => {
    let dragIndex = null;
    container.querySelectorAll('.queue-item').forEach((item) => {
      item.addEventListener('click', () => {
        const idx = Number(item.dataset.index);
        const track = store.state.queue[idx];
        if (!track) return;
        store.update((s) => ({ ...s, currentIndex: idx }));
        playTrack(track, store.state.queue, idx);
      });
      item.addEventListener('dragstart', (e) => {
        dragIndex = Number(item.dataset.index);
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
      });
      item.addEventListener('dragover', (e) => e.preventDefault());
      item.addEventListener('drop', () => {
        const dropIndex = Number(item.dataset.index);
        if (dragIndex === null || dragIndex === dropIndex) return;
        store.update((s) => {
          const next = [...s.queue];
          const [moved] = next.splice(dragIndex, 1);
          next.splice(dropIndex, 0, moved);
          persist.set(STORAGE_KEYS.queue, next);
          let currentIndex = s.currentIndex;
          if (dragIndex === currentIndex) currentIndex = dropIndex;
          return { ...s, queue: next, currentIndex };
        });
        renderQueue();
      });
    });
  };

  // ===========================
  // bindings
  // ===========================
  const bindTrackRowActions = (container, opts = {}) => {
    if (!container) return;
    const rows = Array.from(container.querySelectorAll('.track-row'));
    const queueFromRows = () => rows.map((r) => findTrackById(r.dataset.trackId)).filter(Boolean);
    rows.forEach((row) => {
      const trackId = row.dataset.trackId;
      const track = findTrackById(trackId);
      if (!track) return;

      row.addEventListener('click', (e) => {
        const target = e.target instanceof Element ? e.target : e.target?.parentElement;
        const actionButton = target?.closest('[data-action]');
        const action = actionButton?.dataset?.action;
        if (!action) return;
        if (action === 'play') {
          const queue = queueFromRows();
          const index = queue.findIndex((t) => String(t.id) === String(track.id));
          return playTrack(track, queue.length ? queue : [track], Math.max(0, index));
        }
        if (action === 'like') {
          toggleFavorite(track);
          const likeBtn = row.querySelector('[data-action="like"]');
          setLikeIcon(likeBtn, isFavorite(track.id));
          return;
        }
        if (action === 'add') return openAddToPlaylist(track);
      });

      row.addEventListener('dblclick', () => {
        const queue = queueFromRows();
        const index = queue.findIndex((t) => String(t.id) === String(track.id));
        playTrack(track, queue.length ? queue : [track], Math.max(0, index));
      });

      if (opts.playlistId) {
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          removeFromPlaylist(opts.playlistId, track.id);
        });
      }
    });
  };

  const bindCardActions = (container) => {
    if (!container) return;
    container.querySelectorAll('[data-action]').forEach((card) => {
      card.addEventListener('click', () => {
        const action = card.dataset.action;
        const id = card.dataset.id;
        if (action === 'artist') window.location.hash = `#/artist/${id}`;
        if (action === 'album') window.location.hash = `#/album/${id}`;
        if (action === 'playlist') window.location.hash = `#/playlist/${id}`;
      });
    });
  };

  const openAddToPlaylist = (track) => {
    const { playlists } = store.state.library;
    if (!playlists.length) {
      showToast('Create a playlist first');
      return;
    }
    modal.open(`
      <h3>Add to playlist</h3>
      <div class="tracks">
        ${playlists.map((p) => `
          <div class="track-row" data-id="${p.id}">
            <div class="cover"></div>
            <div class="track-meta">
              <div class="track-title">${p.name}</div>
              <div class="track-sub">${p.tracks.length} tracks</div>
            </div>
            <div class="track-actions"><button class="btn">Add</button></div>
          </div>`).join('')}
      </div>`);
    $$('#modalRoot .track-row').forEach((row) => {
      row.addEventListener('click', () => {
        addToPlaylist(row.dataset.id, track);
        modal.close();
      });
    });
  };

  const openPlaylistModal = (playlist = null) => {
    modal.open(`
      <h3>${playlist ? 'Rename playlist' : 'Create playlist'}</h3>
      <input class="input" id="playlistName" value="${playlist ? playlist.name : ''}" placeholder="Playlist name" />
      <div style="margin-top: 16px; display: flex; gap: 10px;">
        <button class="btn" id="savePlaylist">Save</button>
        <button class="btn ghost" id="cancelPlaylist">Cancel</button>
      </div>`);
    $('#cancelPlaylist').addEventListener('click', () => modal.close());
    $('#savePlaylist').addEventListener('click', () => {
      const name = $('#playlistName').value.trim();
      if (!name) return;
      if (playlist) renamePlaylist(playlist.id, name);
      else createPlaylist(name);
      modal.close();
      renderView();
    });
  };

  const findTrackById = (id) => {
    const reg = trackRegistry.get(String(id));
    if (reg) return reg;
    const fromQueue = store.state.queue.find((t) => String(t.id) === String(id));
    if (fromQueue) return fromQueue;
    const fromFav = store.state.library.favorites.find((t) => String(t.id) === String(id));
    if (fromFav) return fromFav;
    const fromRecently = store.state.recently.find((t) => String(t.id) === String(id));
    if (fromRecently) return fromRecently;
    return null;
  };

  const showCORSMessage = (err) => {
    if (!/Failed to fetch|NetworkError|CORS/i.test(err?.message || '')) return;
    showToast('CORS blocked. Run `node proxy.js`, set window.AURAWAVE_PROXY, reload.');
  };

  // ===========================
  // theme logic
  // ===========================
  const applyTheme = (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    persist.set(STORAGE_KEYS.theme, theme);
  };

  const toggleTheme = () => {
    const next = store.state.theme === 'dark' ? 'light' : 'dark';
    store.update((s) => ({ ...s, theme: next }));
    applyTheme(next);
  };

  const renderSidebarStats = () => {
    const fav = $('#sidebarFavorites');
    const hist = $('#sidebarHistory');
    if (fav) fav.textContent = `${store.state.library.favorites.length} tracks`;
    if (hist) hist.textContent = `${store.state.recently.length} plays`;
  };

  // ===========================
  // initial data
  // ===========================
  const seedSamplePlaylist = async () => {
    const playlists = store.state.library.playlists;
    if (playlists.length) return;
    try {
      const charts = await api.getCharts();
      const tracks = charts.tracks.data.slice(0, 8);
      createPlaylist('Starter Mix', tracks);
    } catch {
      createPlaylist('Starter Mix', []);
    }
  };

  // ===========================
  // init
  // ===========================
  const init = () => {
    applyTheme(store.state.theme);
    bindPlayerControls();
    renderPlayer();
    renderQueue();
    renderSidebarStats();
    seedSamplePlaylist();

    $('#themeToggle').addEventListener('click', toggleTheme);
    $('#themeToggleMobile').addEventListener('click', toggleTheme);

    window.addEventListener('hashchange', navigate);
    navigate();
  };

  store.on(() => {
    renderPlayer();
    renderQueue();
    renderSidebarStats();
  });

  init();
})();
