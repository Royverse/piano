# Models

`hand_landmarker.task` is Google's [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) model (float16, version 1), distributed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

It is served from this repository so hand tracking starts without a third-party download. If it can't be reached, `src/conduct/hands.js` falls back to Google's hosted copy:

https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
