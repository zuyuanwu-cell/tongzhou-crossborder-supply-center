// Plays the short "叮咚" cue before the microphone opens, so people know when to speak.
// Resolves after the cue finishes (or after a safety timeout) so the chime is not recorded.
const CUE_SRC = "/audio/ding.mp3";
const CUE_TIMEOUT_MS = 1100;
const AFTER_CUE_GAP_MS = 120;

function playVoiceStartCue() {
  return new Promise((resolve) => {
    let finished = false;
    let audio = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      try { if (audio) audio.destroy(); } catch (_) {}
      setTimeout(resolve, AFTER_CUE_GAP_MS);
    };
    try { if (wx.vibrateShort) wx.vibrateShort({ type: "medium" }); } catch (_) {}
    try {
      // Play even when the phone is on silent; the recorder still works afterwards.
      if (wx.setInnerAudioOption) wx.setInnerAudioOption({ obeyMuteSwitch: false, mixWithOther: true });
      audio = wx.createInnerAudioContext();
      audio.onEnded(finish);
      audio.onError(finish);
      audio.src = CUE_SRC;
      audio.play();
    } catch (_) {
      finish();
      return;
    }
    setTimeout(finish, CUE_TIMEOUT_MS);
  });
}

module.exports = { playVoiceStartCue };
