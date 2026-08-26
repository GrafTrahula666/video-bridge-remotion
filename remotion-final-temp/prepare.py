from pathlib import Path
import json, math, os, subprocess, wave
import numpy as np

ROOT = Path('remotion-final-temp')
PUB = ROOT / 'public'
V1 = PUB / 'source-video-1.mp4'
V2 = PUB / 'source-video-2.mp4'
FPS = 24


def probe(path: Path):
    raw = subprocess.check_output([
        'ffprobe','-v','error','-show_entries','format=duration,size',
        '-show_entries','stream=codec_type,codec_name,width,height,r_frame_rate',
        '-of','json',str(path)
    ], text=True)
    return json.loads(raw)

for p in (V1, V2):
    if not p.exists() or p.stat().st_size <= 0:
        raise RuntimeError(f'Missing source: {p}')
    info = probe(p)
    video = next((s for s in info['streams'] if s.get('codec_type') == 'video'), None)
    if not video:
        raise RuntimeError(f'Unreadable video: {p}')
    print(p.name, json.dumps(info, ensure_ascii=False))

# Extract last/first 1.5 sec at 24 fps, 64x64 grayscale for conservative overlap matching.
subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-sseof','-1.5','-i',str(V1),
                '-vf','fps=24,scale=64:64,format=gray','-f','rawvideo','tail.raw'], check=True)
subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(V2),'-t','1.5',
                '-vf','fps=24,scale=64:64,format=gray','-f','rawvideo','head.raw'], check=True)
frame_size=64*64

def frames(path):
    b=Path(path).read_bytes()
    return [b[i:i+frame_size] for i in range(0,len(b)-frame_size+1,frame_size)]

a,b=frames('tail.raw'),frames('head.raw')

def mad(x,y):
    return sum(abs(i-j) for i,j in zip(x,y))/(len(x)*255)

chosen=1
score=mad(a[-1],b[0]) if a and b else 1.0
for k in range(1,min(len(a),len(b),24)+1):
    s=sum(mad(a[-k+i],b[i]) for i in range(k))/k
    if s < 0.055:
        chosen=k; score=s
chosen=min(chosen,12)
print(f'Detected overlap: {chosen} frames ({chosen/FPS:.3f}s), score={score:.6f}')

p1=probe(V1); p2=probe(V2)
d1=float(p1['format']['duration']); d2=float(p2['format']['duration'])
f1=round(d1*FPS); f2=round(d2*FPS)
Path('render.env').write_text(f'FIRST_FRAMES={f1}\nSECOND_FRAMES={f2}\nOVERLAP_FRAMES={chosen}\n')

# Original instrumental score: dark forest drone -> ritual drums -> jaw harp -> climax -> quiet release.
sr=48000
dur=(f1+f2-chosen)/FPS
n=int(dur*sr)
t=np.arange(n,dtype=np.float64)/sr
rng=np.random.default_rng(20260827)
slow=0.72+0.28*np.sin(2*np.pi*0.045*t+0.4)
music=(0.115*np.sin(2*np.pi*55*t)+0.060*np.sin(2*np.pi*82.5*t+0.7)+0.038*np.sin(2*np.pi*110*t+1.3))*slow
noise=rng.normal(0,1,n)
music += np.convolve(noise,np.ones(260)/260,mode='same')*0.045

def drum(at,amp=0.5):
    s=int(at*sr); L=min(n-s,int(0.72*sr))
    if L<=0:return
    x=np.arange(L)/sr
    env=np.exp(-6.2*x)
    freq=115*np.exp(-3*x)+42
    phase=2*np.pi*np.cumsum(freq)/sr
    body=np.sin(phase)
    click=rng.normal(0,1,L)*np.exp(-18*x)
    music[s:s+L]+=amp*env*(0.86*body+0.14*click)

beat=60/78
at=3.1; i=0
while at<dur-2.0:
    p=at/dur
    drum(at,0.28+0.34*p)
    if p>0.42 and i%2: drum(at+beat/2,0.20+0.22*p)
    if p>0.68: drum(at+beat/4,0.14+0.14*p)
    at+=beat; i+=1

for at in np.arange(max(7.0,dur*0.34),dur*0.82,beat*2):
    s=int(at*sr); L=min(n-s,int(0.85*sr))
    if L<=0: continue
    x=np.arange(L)/sr
    env=np.exp(-3.5*x)
    phase=2*np.pi*np.cumsum(123+7*np.sin(2*np.pi*4.2*x))/sr
    music[s:s+L]+=(np.sin(phase)+0.38*np.sin(2*phase)+0.18*np.sin(3*phase))*env*0.10

# Subtle non-verbal ritual voice-like overtone, kept low in the mix.
s=int(dur*0.46*sr); e=int(dur*0.90*sr)
if e>s:
    x=t[s:e]-t[s]
    fade=np.sin(np.linspace(0,np.pi,e-s))**1.2
    chant=(np.sin(2*np.pi*164*x)+0.34*np.sin(2*np.pi*246*x+0.8))*0.032*fade
    chant*=0.75+0.25*np.sin(2*np.pi*1.6*x)
    music[s:e]+=chant

# Rising supernatural pressure.
s=int(dur*0.62*sr); e=int(dur*0.86*sr)
if e>s:
    x=np.arange(e-s)/sr; rise=np.linspace(0,1,e-s)
    music[s:e]+=0.065*rise*np.sin(2*np.pi*(39+5*rise)*x)

# Tiny vacuum before a low-frequency impact.
cs=int(dur*0.80*sr); ce=min(n,cs+int(0.16*sr))
if ce>cs: music[cs:ce]*=np.linspace(1.0,0.15,ce-cs)
s=ce; L=min(n-s,int(1.4*sr))
if L>0:
    x=np.arange(L)/sr
    music[s:s+L]+=0.58*np.sin(2*np.pi*(58*np.exp(-1.6*x)+30)*x)*np.exp(-3.4*x)

# Gentle ending.
fs=int(dur*0.92*sr)
if fs<n: music[fs:]*=np.linspace(1.0,0.22,n-fs)

delay=int(0.013*sr)
left=music.copy(); right=np.concatenate([np.zeros(delay),music[:-delay]]) if delay<n else music.copy()
stereo=np.stack([left,right],axis=1)
peak=max(1e-9,float(np.max(np.abs(stereo))))
stereo=np.tanh(stereo/(peak*0.90))*0.86
pcm=np.int16(np.clip(stereo,-1,1)*32767)
out=PUB/'ritual-music.wav'
with wave.open(str(out),'wb') as wf:
    wf.setnchannels(2); wf.setsampwidth(2); wf.setframerate(sr); wf.writeframes(pcm.tobytes())
print(f'Music: {out}, duration={dur:.3f}s')
