var x_api_key = "132657ef-f954-4114-a0a7-1c5bec6d068d";
var fetch_url = "http://localhost:4000/api/test_upload";
var gravando = false;

/** Roda a função base do script, que seleciona a div pra colocar o botão dentro e cria o botão com os eventos bindados.
 */
async function runScript() {
  let divSelecionada = document.querySelector("#btn_recording_integration");
  let btn = document.createElement("button");

  divSelecionada.append(btn);

  btn.innerHTML = "Gravar";
  btn.addEventListener("click", async () => {
      if (gravando === false) {
          //console.log("click");
          let file = await startCapture();
          let fileRef = URL.createObjectURL(file);
          //console.log("received blob url:" + fileRef);
          downloadButton.href = fileRef;
          downloadButton.download = "RecordedAudio.webm";
    
          // Fetch API request
          const formData = new FormData();
          formData.append("file", file, "RecordedAudio.webm");
          
          fetch(fetch_url, {
            method: 'POST',
            body: formData,
            headers: {
              "x-api-key": x_api_key
            }
          }).then(response => response.json())
            .then(data => console.log(data))
            .catch(error => console.error(error));
      } else {
          stopCapture();
          gravando = false;
      }
  })

  window.addEventListener("beforeunload", (e) => {
    if (gravando) {
      setTimeout(() => {
        alert("Por favor, conclua a gravação antes de fechar o navegador.");
      }, 2000);

      e.preventDefault();    // actual work on modern browsers
      e.returnValue = true;  // legacy support

      window.alert("test");
    }
  });
}

//==============================================================================
//==============================================================================
//==============================================================================

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
  //console.log("internal start capture");

  try {
    let userMicStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true, });
    sourceToStop_01 = userMicStream;
    let displayMediaCombinedStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
    sourceToStop_02 = displayMediaCombinedStream;
    //throw error and call stop rec (release streams) if any of these go awry
    gravando = true;

    const audioTrackFromCombined = displayMediaCombinedStream.getAudioTracks()[0];
    const videoTrackFromCombined = displayMediaCombinedStream.getVideoTracks()[0];
    videoTrackFromCombined.stop();
    // ^ aqui a esperança é matar o fluxo de vídeo, mantendo o de áudio vivo 
    //(https://github.com/w3c/mediacapture-screen-share-extensions/issues/12#issuecomment-1960941085)

    // isso aqui detecta caso o nosso belíssimo usuário feche a página, ou clique no btn de parar de transmitir; em tese é pra disparar o evento do stopCapture e enviar o arquivo, mas se isso realmente vai ocorrer é um mistério :)
    audioTrackFromCombined.onended = () => {
      stopCapture();
    }

    // multiple audio tracks extraction from stream
    //(https://stackoverflow.com/questions/75598622/how-do-i-capture-only-audio-from-mediadevices-getdisplaymedia)
    // audio stream union
    //(https://stackoverflow.com/questions/64717758/merge-two-audio-tracks-into-one-track)
    var OutgoingMediaStream = new MediaStream();
    for (const track of displayMediaCombinedStream.getAudioTracks()) {
      OutgoingMediaStream.addTrack(track);
    }
    var IngoingMediaStream = new MediaStream(userMicStream);

    const audioContext = new AudioContext(); //{sampleRate: 22050} <- unclear se tá funcionando como esperado ou não

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
    
    console.log(
      `Successfully recorded ${recordedBlob.size} bytes of ${recordedBlob.type} media.`,
    );

    return recordedBlob;
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
  const options = {
    mimeType: 'audio/webm',
    audioBitsPerSecond: 32000,  // <- ISSO parece estar funcionando; parece que meiou, talvez até um pouco mais, o tamanho dos arquivos. //64k é ok ainda, 32k parece ok tbm, 1h dá uns 15MB
  };

  recorderToStop = new MediaRecorder(stream, options);
  let data = [];

  recorderToStop.ondataavailable = (event) => data.push(event.data);
  recorderToStop.start();
  //console.log(`${recorderToStop.state} - audio channel`);

  let stopped = new Promise((resolve, reject) => {
    recorderToStop.onstop = resolve;
    recorderToStop.onerror = (event) => reject(event.name);
  });

  return stopped.then(() => data);
}

runScript();
export { startCapture, stopCapture, x_api_key, fetch_url };