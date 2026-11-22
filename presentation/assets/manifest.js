/*
 * ComForce Mobile keynote: asset manifest.
 *
 * Swapping a capture is a one-line change: drop the new file into
 * assets/shots or assets/video and point the matching line here at it
 * (or overwrite the file with the same name).
 *
 * Phones that play a video use { video, poster }. The poster shows in the PDF
 * and in the presenter previews, so swap it along with the video when you can.
 * Missing files: the phone tries fallbackVideo, then the poster, then shows a
 * placeholder with the label, and keeps checking so the clip swaps in by itself
 * once the file appears (no reload needed).
 * Options:  loop: false  plays once and holds the last frame
 *           sound: true  plays with audio (needs a keypress in the deck window first)
 *           start/stop   play only that span of the clip, then hold
 *           end: 5.6     loops only the first 5.6 s of the clip
 *           dark: true   dark screen behind the video (dark-mode captures)
 *
 * Plain <script> (not a module) so it works from file:// with no server.
 * The old (v1) captures are in assets/old-20261122/.
 */
window.DECK_ASSETS = {
  // Title (pre-show): the two sides of the app, from the final captures.
  titleResident: 'assets/shots/resident-status-final.png',
  titleStaff:    'assets/shots/staff-today.png',

  // Beat 2 · "Someone always answers." Real iPhone recording of the on-call push.
  // If this file is missing, the deck plays a built-in synthetic version of the
  // same choreography (CSS lock screen, then urgent.mp4). Drop the file back in
  // and reload to use the real one.
  push: {
    video: 'assets/video/push-notification.mp4',
    poster: 'assets/shots/poster-push.png',
    loop: false, dark: true,
    // Camera moves, keyed to the clip's own time: [seconds, zoom, focusX, focusY, shiftX]
    // focus is a point on the screen (0..1) the camera centres on; shiftX moves the
    // phone across the stage (-555 = centre of the stage, 0 = its resting place on the right).
    camera: [
      [0.0, 1.0, 0.5, 0.5, -555], [1.9, 1.0, 0.5, 0.5, -555],
      [2.9, 1.8, 0.5, 0.80, -555], [5.15, 1.8, 0.5, 0.80, -555],  // banner arrives at 2.0 s; hold until the tap
      [5.6, 1.55, 0.5, 0.70, -555], [6.8, 1.15, 0.5, 0.55, -300],  // follow the tap as the app opens
      [7.8, 1.0, 0.5, 0.5, 0]                                      // whole phone on the urgent alert, headline arrives
    ],
    tap: { t: 5.1, x: 0.5, y: 0.80 },
    // Synthetic fallback (used only when the video fails to load)
    fallback: { lockTime: '4:09', lockDate: 'Sunday, November 22', appAt: 5.3, appVideo: 'assets/video/urgent.mp4', appPoster: 'assets/shots/urgent-final.png' }
  },

  // Beat 3 · "The case builds itself." Team chat takes over the phone on the second build.
  caseMgmt:   { video: 'assets/video/case.mp4', poster: 'assets/shots/case-final.png' },
  teamChat:   { video: 'assets/video/team-chat.mp4', poster: 'assets/shots/team-chat-final.png', label: 'Team chat' },
  staffToday: 'assets/shots/staff-today.png',

  // Beat 4 · "She's not left wondering."
  resident:   { video: 'assets/video/resident-status.mp4', poster: 'assets/shots/resident-status-final.png' },

  // Beat 5 · consent and the partner share
  partners:   { video: 'assets/video/partners.mp4', poster: 'assets/shots/partners-final.png', label: 'Partner share' },

  // Beat 6 · a real spoken debrief, WITH SOUND (the only clip with audio).
  // Plays from 2.6 s (Debrief opens) to 21.5 s (Check before saving), then holds.
  phantomVoice: { video: 'assets/video/phantom-voice.mp4', poster: 'assets/shots/phantom-voice-final.png', sound: true, start: 2.6, stop: 21.5, playOn: 1, label: 'Spoken debrief' },

  // Beat 7 · "Help arrived."
  delivered:  { video: 'assets/video/delivered-handoff.mp4', poster: 'assets/shots/delivered-handoff-final.png' },

  // Beat 8 · Insights (pattern, then "Where help is needed" with real data)
  insights:   { video: 'assets/video/insights.mp4', poster: 'assets/shots/insights-final.png' },

  // Beat 9 · "And everything around it" montage
  getHelp:    { video: 'assets/video/get-help.mp4', poster: 'assets/shots/get-help-final.png', label: 'Get help' },
  jobs:       { video: 'assets/video/jobs.mp4', poster: 'assets/shots/jobs-final.png', label: 'Jobs & programs' },
  community:  { video: 'assets/video/community.mp4', poster: 'assets/shots/community-final.png', label: 'Community view' },
  tasks:      { video: 'assets/video/tasks.mp4', poster: 'assets/shots/tasks-final.png', label: 'My tasks' },
  queue:      { video: 'assets/video/queue.mp4', poster: 'assets/shots/queue-final.png', label: 'Queue' },
  safetyMap:  { video: 'assets/video/safety-map.mp4', poster: 'assets/shots/safety-map-final.png', label: '911 call map' },

  // Beat 10 · "The whole team gets better."
  training:   { video: 'assets/video/training.mp4', poster: 'assets/shots/training-final.png' },
  exportRecs: 'assets/shots/staff-export.png'
};

// The call (beat 1) is assets/audio/call/call-full.mp3, with its words and
// loudness in assets/audio/call/call-data.js (generated from call-timeline.json).

window.DECK_CONFIG = {
  // Shown on the closing slide.
  link: 'hacksgiving.austinkoske.com',
  callAudio: 'assets/audio/call/call-full.mp3',
  callDuckVolume: 0.35   // the caller's last line keeps playing this loud under the cut
};
