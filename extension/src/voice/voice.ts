console.log("🌌 PIXEL NOVA Voice Commander Script Initialized");

const statusDesc = document.getElementById("status-desc") as HTMLParagraphElement;
const micRing = document.getElementById("mic-ring") as HTMLDivElement;
const btnMic = document.getElementById("btn-mic-toggle") as HTMLButtonElement;
const transcriptBox = document.getElementById("transcript-box") as HTMLDivElement;
const btnSend = document.getElementById("btn-send") as HTMLButtonElement;

const chkAutoRun = document.getElementById("chk-auto-run") as HTMLInputElement;

let recognition: any = null;
let isRecording = false;
let currentTranscript = "";
let autoSendTimer: any = null;

function dispatchToAgent(text: string, autoRun: boolean) {
  if (!text) return;
  stopListening();

  chrome.runtime.sendMessage({
    type: "VOICE_INPUT_CAPTURED",
    text,
    autoRun
  });

  statusDesc.innerText = "Dispatched to PIXEL NOVA Agent! Closing window...";
  transcriptBox.innerText = `"${text}"`;
  transcriptBox.style.borderColor = "#10b981";

  setTimeout(() => {
    window.close();
  }, 650);
}

async function initMicrophoneAndListen() {
  try {
    statusDesc.innerText = "Requesting microphone permission...";
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Stop raw tracks so speech recognition can bind to device
    stream.getTracks().forEach((track) => track.stop());

    statusDesc.innerText = "Microphone authorized! Ready to listen.";
    startListening();
  } catch (err: any) {
    console.error("Microphone access error:", err);
    statusDesc.innerText = "Microphone permission was blocked. Please click the lock icon in the address bar to allow microphone access.";
    transcriptBox.innerText = "Microphone access denied.";
  }
}

function startListening() {
  const SpeechRec = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
  if (!SpeechRec) {
    statusDesc.innerText = "Speech recognition is not supported in this browser.";
    return;
  }

  try {
    recognition = new SpeechRec();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      isRecording = true;
      btnMic.classList.add("active");
      micRing.style.display = "block";
      statusDesc.innerText = "Listening... Speak your goal or compound command.";
      transcriptBox.classList.remove("empty");
    };

    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";

      for (let i = 0; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += text;
        } else {
          interim += text;
        }
      }

      currentTranscript = (final + " " + interim).trim();
      if (currentTranscript) {
        transcriptBox.innerText = `"${currentTranscript}"`;
        btnSend.disabled = false;

        // If auto-run is enabled and we have a final recognized sentence, auto-send after 2s of quiet
        if (chkAutoRun?.checked && final) {
          clearTimeout(autoSendTimer);
          statusDesc.innerText = "Silence detected. Executing in 2s...";
          autoSendTimer = setTimeout(() => {
            dispatchToAgent(currentTranscript, true);
          }, 2000);
        }
      }
    };

    recognition.onerror = (event: any) => {
      console.warn("Recognition error:", event.error);
      if (event.error === "not-allowed") {
        statusDesc.innerText = "Microphone permission denied.";
      }
    };

    recognition.onend = () => {
      if (isRecording) {
        // Auto-restart if still flagged recording
        try {
          recognition.start();
        } catch (e) {}
      } else {
        btnMic.classList.remove("active");
        micRing.style.display = "none";
      }
    };

    recognition.start();
  } catch (e) {
    console.error("Failed to start speech recognition:", e);
  }
}

function stopListening() {
  isRecording = false;
  clearTimeout(autoSendTimer);
  if (recognition) {
    try {
      recognition.stop();
    } catch (e) {}
  }
  btnMic.classList.remove("active");
  micRing.style.display = "none";
  statusDesc.innerText = "Recording paused.";
}

btnMic.addEventListener("click", () => {
  if (isRecording) {
    stopListening();
  } else {
    startListening();
  }
});

btnSend.addEventListener("click", () => {
  if (!currentTranscript) return;
  const shouldAutoRun = chkAutoRun ? chkAutoRun.checked : true;
  dispatchToAgent(currentTranscript, shouldAutoRun);
});

// Setup quick suggestion chips
document.querySelectorAll<HTMLButtonElement>(".suggestion-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const cmd = chip.getAttribute("data-cmd") || chip.innerText;
    currentTranscript = cmd;
    transcriptBox.innerText = `"${cmd}"`;
    transcriptBox.classList.remove("empty");
    btnSend.disabled = false;
    const shouldAutoRun = chkAutoRun ? chkAutoRun.checked : true;
    dispatchToAgent(cmd, shouldAutoRun);
  });
});

// Auto-request on page load
initMicrophoneAndListen();
