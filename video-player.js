'use strict';

// Keep video playback available when the page is opened directly from disk.
(() => {
  for (const play of document.querySelectorAll('[data-play]')) {
    const video = document.getElementById(play.dataset.play);
    let hasStarted = !video.paused || video.currentTime > 0 || video.played.length > 0;
    const hideOverlay = () => { play.hidden = true; video.controls = true; };
    const rememberStarted = () => { hasStarted = true; hideOverlay(); };
    const pauseOtherVideos = () => {
      for (const other of document.querySelectorAll('video')) if (other !== video) other.pause();
    };
    const syncPlayback = () => {
      if (video.currentTime > 0 || video.played.length > 0) hasStarted = true;
      if (hasStarted || !video.paused) hideOverlay();
    };
    video.controls = hasStarted;
    play.hidden = hasStarted;
    play.addEventListener('click', async () => {
      hideOverlay();
      pauseOtherVideos();
      try { await video.play(); rememberStarted(); }
      catch {
        syncPlayback();
        if (!hasStarted && video.paused) { play.hidden = false; video.controls = true; }
      }
    });
    video.addEventListener('play', () => {
      hideOverlay();
      pauseOtherVideos();
    });
    video.addEventListener('playing', () => {
      rememberStarted();
      pauseOtherVideos();
    });
    for (const event of ['loadedmetadata', 'seeked', 'timeupdate', 'pause', 'ended']) video.addEventListener(event, syncPlayback);
    window.addEventListener('pageshow', syncPlayback);
  }
})();
