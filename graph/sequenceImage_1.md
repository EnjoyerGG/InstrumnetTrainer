```mermaid
sequenceDiagram
actor User
participant Mic as WebAudio/p5.Sound Mic
participant DT as DrumTrigger.update()
participant RM as RhythmManager
participant SW as SweepMode
participant HM as HitMarkers
participant NIF as NoteIlluminateFeedback
participant Loop as p5.draw()

User->>Mic: 敲击（声波）
Mic->>DT: 音频缓冲
DT->>DT: _analyzeDrumFeatures() / _isDrumHit()
alt 命中
  DT-->>App: _onTrigger(reason) 
  App->>RM: registerHit(hitType?)
  App->>SW: addHitNow()
  App->>HM: addHitMarker(RM._t())
end
Loop->>NIF: render()   
Loop->>HM: render()    
```