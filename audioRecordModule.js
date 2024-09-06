/**
 * Módulo para a gravação simultânea de áudio vindo do mic do usuário e da aba do navegador aberta.
 * Preocupação sobre compatibilidade entre navegadores. Talvez posteriormente tratar com https://github.com/webrtc/adapter
 *
 * @module
 */

var sourceToStop_01;
var sourceToStop_02;
var recorderToStop;

// Options for getDisplayMedia()

// não tem como capturar só áudio; a esperança é isolar o áudio com ferramentas do kit mesmo
// loucura de SOMEHOW fazer o browser só sugerir a própria guia :)
// (https://stackoverflow.com/questions/73742556/how-to-use-navigator-getdisplaymedia-with-auto-selecting-the-screen) e
// (https://stackoverflow.com/questions/75912092/navigator-mediadevices-getdisplaymedia-does-not-show-the-current-tab)
const displayMediaOptions = {
  video: {
    displaySurface: "browser",
  },
  audio: {
    channelCount: 2,
    echoCancellation: true,
    noiseSuppression: true,
  },
  selfBrowserSurface: "include",
  monitorTypeSurface: "exclude",
  preferCurrentTab: true,

};

/** Inicia a captura do áudio do mic e da aba atual do navegador.
 * O usuário PRECISA dar permissão para acessar o mic e o áudio da aba.
 * Embora a permissão diga que vai capturar a tela, oficialmente a trilha de vídeo é encerrada quase imediatamente - é culpa do devkit que não permite uma requisição exclusiva de streaming de áudio. 
 * Considerações sobre a quantidade de memória requerida para armazenar a gravação estão em análise.
 * Retorna um Blob contendo a gravação em formato WEBM (áudio). */
async function startCapture() {
  console.log("internal start capture");

  try {
    let userMicStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true, });
    sourceToStop_01 = userMicStream;
    let displayMediaCombinedStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
    sourceToStop_02 = displayMediaCombinedStream;
    //throw error and call stop rec (release streams) if any of these go awry

    const audioTrackFromCombined = displayMediaCombinedStream.getAudioTracks()[0];
    const videoTrackFromCombined = displayMediaCombinedStream.getVideoTracks()[0];
    videoTrackFromCombined.stop();
    // ^ aqui a esperança é matar o fluxo de vídeo, mantendo o de áudio vivo 
    //(https://github.com/w3c/mediacapture-screen-share-extensions/issues/12#issuecomment-1960941085)

    // multiple audio tracks extraction from stream
    //(https://stackoverflow.com/questions/75598622/how-do-i-capture-only-audio-from-mediadevices-getdisplaymedia)
    // audio stream union
    //(https://stackoverflow.com/questions/64717758/merge-two-audio-tracks-into-one-track)
    var OutgoingMediaStream = new MediaStream();
    for (const track of displayMediaCombinedStream.getAudioTracks()) {
      OutgoingMediaStream.addTrack(track);
    }
    var IngoingMediaStream = new MediaStream(userMicStream);

    const audioContext = new AudioContext();

    let audioIn_01 = await audioContext.createMediaStreamSource(OutgoingMediaStream);
    let audioIn_02 = await audioContext.createMediaStreamSource(IngoingMediaStream);

    let mediaStreamDestination = audioContext.createMediaStreamDestination();

    audioIn_01.connect(mediaStreamDestination);
    audioIn_02.connect(mediaStreamDestination);

    var finalStream = mediaStreamDestination.stream;

    //console.log("started rec\n");
    const recordedChunks = await startRecording(finalStream);
    //console.log("stopped rec\n");
    // pra parar ainda to usando o hack do video mas como audio :D

    let recordedBlob = new Blob(recordedChunks, { type: "audio/webm" });
    // recording.src = URL.createObjectURL(recordedBlob);
    // downloadButton.href = recording.src;
    // downloadButton.download = "RecordedAudio.webm";
    
    console.log(
      `Successfully recorded ${recordedBlob.size} bytes of ${recordedBlob.type} media.`,
    );

    return await generateFileURL(recordedBlob);
  } catch (err) {
    stopCapture();
    console.error(err);
  }
}

async function generateFileURL(generatedFile) {
  const blob = await generatedFile;
  const url = URL.createObjectURL(blob);
  return url;
}

/** Termina a captura, caso esteja ocorrendo. */
async function stopCapture(evt) {
  //console.log('stop function fired\n');

  let tracks = sourceToStop_01.getTracks();
  tracks.forEach((track) => track.stop());

  tracks = sourceToStop_02.getTracks();
  tracks.forEach((track) => track.stop());

  recorderToStop.stop();
}

// função de gravar alterada: só para de gravar no evento de stop do recorder (espera-se)
async function startRecording(stream) {
  recorderToStop = new MediaRecorder(stream);
  let data = [];

  recorderToStop.ondataavailable = (event) => data.push(event.data);
  recorderToStop.start();
  console.log(`${recorderToStop.state} - audio channel`);

  let stopped = new Promise((resolve, reject) => {
    recorderToStop.onstop = resolve;
    recorderToStop.onerror = (event) => reject(event.name);
  });

  return stopped.then(() => data);
}

export { startCapture, stopCapture };