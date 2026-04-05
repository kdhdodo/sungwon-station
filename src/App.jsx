import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
];

function App() {
  const [status, setStatus] = useState("waiting");
  const [cameras, setCameras] = useState([]);
  const videoRefs = useRef({});
  const pcRefs = useRef({});
  const pollRefs = useRef({});

  useEffect(() => {
    loadCameras();
    const interval = setInterval(loadCameras, 5000);
    return () => {
      clearInterval(interval);
      Object.values(pollRefs.current).forEach(clearInterval);
      Object.values(pcRefs.current).forEach(pc => pc.close());
    };
  }, []);

  const loadCameras = async () => {
    const { data } = await supabase.from("sw_cameras").select("*").order("created_at");
    if (data) setCameras(data);
  };

  const requestStream = async (camId) => {
    setStatus("requesting");

    // 기존 연결 정리
    if (pcRefs.current[camId]) {
      pcRefs.current[camId].close();
      delete pcRefs.current[camId];
    }
    if (pollRefs.current[camId]) {
      clearInterval(pollRefs.current[camId]);
      delete pollRefs.current[camId];
    }

    // 기존 시그널 정리 후 request 보내기
    await supabase.from("sw_signals").delete().eq("cam_id", camId);
    await supabase.from("sw_signals").insert({
      cam_id: camId, type: "request-stream", data: "request"
    });

    // 시그널 폴링 시작 (request 이후 시그널만)
    let lastId = 0;
    pollRefs.current[camId] = setInterval(async () => {
      const { data: signals } = await supabase.from("sw_signals")
        .select("*")
        .eq("cam_id", camId)
        .gt("id", lastId)
        .order("id");

      if (!signals) return;

      for (const sig of signals) {
        lastId = sig.id;

        if (sig.type === "offer") {
          await handleOffer(camId, sig.data);
        } else if (sig.type === "ice-candidate") {
          const pc = pcRefs.current[camId];
          if (pc) {
            try {
              const candidate = JSON.parse(sig.data);
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
              console.error("ICE error:", e);
            }
          }
        }
      }
    }, 1000);
  };

  const handleOffer = async (camId, sdp) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRefs.current[camId] = pc;

    pc.ontrack = (event) => {
      const video = videoRefs.current[camId];
      if (video && event.streams[0]) {
        video.srcObject = event.streams[0];
        setStatus("connected");
      }
    };

    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        await supabase.from("sw_signals").insert({
          cam_id: camId,
          type: "ice-candidate-answer",
          data: JSON.stringify(event.candidate.toJSON())
        });
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "connected") setStatus("connected");
      else if (state === "disconnected" || state === "failed") setStatus("disconnected");
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp }));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await supabase.from("sw_signals").insert({
        cam_id: camId, type: "answer", data: answer.sdp
      });

      setStatus("connecting");
    } catch (e) {
      console.error("Offer error:", e);
      setStatus("error");
    }
  };

  const statusText = {
    waiting: "Waiting...",
    requesting: "Requesting...",
    connecting: "Connecting...",
    connected: "Connected",
    disconnected: "Disconnected",
    error: "Error"
  };

  const statusColor = status === "connected" ? "#4CAF50" : "#888";

  return (
    <div style={{ minHeight: "100vh", padding: 24 }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 24, borderBottom: "1px solid #1a1d27", paddingBottom: 16
      }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#f5c518", letterSpacing: "0.05em" }}>
            Sungwon Station
          </div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>Real-time Camera Monitor</div>
        </div>
        <div style={{ fontSize: 11, color: statusColor, display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor }} />
          {statusText[status]}
        </div>
      </div>

      {/* No cameras */}
      {cameras.length === 0 && (
        <div style={{
          background: "#11141c", borderRadius: 12, padding: 40,
          textAlign: "center", color: "#555", fontSize: 14
        }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📷</div>
          <div style={{ marginBottom: 8 }}>No cameras connected</div>
          <div style={{ fontSize: 11, color: "#444" }}>
            Start SungwonCam app on your phone
          </div>
        </div>
      )}

      {/* Camera grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: cameras.length === 1 ? "1fr" : "repeat(auto-fill, minmax(400px, 1fr))",
        gap: 16
      }}>
        {cameras.map(cam => (
          <div key={cam.id} style={{ background: "#11141c", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ position: "relative", width: "100%", paddingTop: "56.25%", background: "#000" }}>
              <video
                ref={el => videoRefs.current[cam.id] = el}
                autoPlay playsInline muted
                style={{
                  position: "absolute", top: 0, left: 0,
                  width: "100%", height: "100%", objectFit: "contain"
                }}
              />
              {status === "connected" && (
                <div style={{
                  position: "absolute", top: 8, left: 12,
                  background: "rgba(0,0,0,0.6)", borderRadius: 4,
                  padding: "3px 8px", fontSize: 10, color: "#f44"
                }}>
                  ● LIVE
                </div>
              )}
            </div>
            <div style={{ padding: "12px 16px", display: "flex", alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>{cam.name}</div>
                <div style={{ color: "#555", fontSize: 10, marginTop: 2 }}>
                  {new Date(cam.created_at).toLocaleString("ko-KR")}
                </div>
              </div>
              <button onClick={() => requestStream(cam.id)}
                style={{
                  background: "#f5c518", color: "#000", border: "none",
                  borderRadius: 6, padding: "8px 16px", fontSize: 12,
                  fontWeight: 700, cursor: "pointer"
                }}>
                Connect
              </button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ textAlign: "center", color: "#333", fontSize: 10, marginTop: 40, padding: 20 }}>
        Sungwon Station v1.0
      </div>
    </div>
  );
}

export default App;
