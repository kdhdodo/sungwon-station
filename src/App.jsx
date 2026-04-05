import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

function App() {
  const [status, setStatus] = useState("대기 중...");
  const [cameras, setCameras] = useState([]);
  const videoRefs = useRef({});
  const pcRefs = useRef({});

  useEffect(() => {
    // 활성 카메라 목록 가져오기
    loadCameras();

    // Supabase Realtime으로 시그널링 수신
    const channel = supabase.channel("webrtc-signal")
      .on("broadcast", { event: "offer" }, async ({ payload }) => {
        const { camId, sdp } = payload;
        await handleOffer(camId, sdp);
      })
      .on("broadcast", { event: "ice-candidate" }, async ({ payload }) => {
        const { camId, candidate } = payload;
        const pc = pcRefs.current[camId];
        if (pc && candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.error("ICE candidate error:", e);
          }
        }
      })
      .on("broadcast", { event: "camera-online" }, ({ payload }) => {
        loadCameras();
      })
      .on("broadcast", { event: "camera-offline" }, ({ payload }) => {
        const { camId } = payload;
        if (pcRefs.current[camId]) {
          pcRefs.current[camId].close();
          delete pcRefs.current[camId];
        }
        setCameras(prev => prev.filter(c => c.id !== camId));
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
      Object.values(pcRefs.current).forEach(pc => pc.close());
    };
  }, []);

  const loadCameras = async () => {
    const { data } = await supabase.from("sw_cameras").select("*").order("created_at");
    if (data) setCameras(data);
  };

  const handleOffer = async (camId, sdp) => {
    // 기존 연결 정리
    if (pcRefs.current[camId]) {
      pcRefs.current[camId].close();
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRefs.current[camId] = pc;

    pc.ontrack = (event) => {
      const video = videoRefs.current[camId];
      if (video && event.streams[0]) {
        video.srcObject = event.streams[0];
        setStatus("연결됨");
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        supabase.channel("webrtc-signal").send({
          type: "broadcast",
          event: "ice-candidate-answer",
          payload: { camId, candidate: event.candidate.toJSON() },
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        setStatus("연결 끊김");
      }
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp }));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // answer를 앱으로 전송
      await supabase.channel("webrtc-signal").send({
        type: "broadcast",
        event: "answer",
        payload: { camId, sdp: answer.sdp },
      });
    } catch (e) {
      console.error("Offer handling error:", e);
      setStatus("연결 실패");
    }
  };

  const requestStream = async (camId) => {
    setStatus("연결 요청 중...");
    await supabase.channel("webrtc-signal").send({
      type: "broadcast",
      event: "request-stream",
      payload: { camId },
    });
  };

  return (
    <div style={{ minHeight: "100vh", padding: 24 }}>
      {/* 헤더 */}
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
        <div style={{
          fontSize: 11, color: status.includes("연결됨") ? "#4CAF50" : "#888",
          display: "flex", alignItems: "center", gap: 6
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: status.includes("연결됨") ? "#4CAF50" : "#555"
          }} />
          {status}
        </div>
      </div>

      {/* 카메라 없음 */}
      {cameras.length === 0 && (
        <div style={{
          background: "#11141c", borderRadius: 12, padding: 40,
          textAlign: "center", color: "#555", fontSize: 14
        }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📷</div>
          <div style={{ marginBottom: 8 }}>연결된 카메라가 없습니다</div>
          <div style={{ fontSize: 11, color: "#444" }}>
            SungwonCam 앱에서 스트리밍을 시작하세요
          </div>
        </div>
      )}

      {/* 카메라 그리드 */}
      <div style={{
        display: "grid",
        gridTemplateColumns: cameras.length === 1 ? "1fr" : "repeat(auto-fill, minmax(400px, 1fr))",
        gap: 16
      }}>
        {cameras.map(cam => (
          <div key={cam.id} style={{
            background: "#11141c", borderRadius: 12, overflow: "hidden"
          }}>
            {/* 비디오 */}
            <div style={{ position: "relative", width: "100%", paddingTop: "56.25%", background: "#000" }}>
              <video
                ref={el => videoRefs.current[cam.id] = el}
                autoPlay
                playsInline
                muted
                style={{
                  position: "absolute", top: 0, left: 0,
                  width: "100%", height: "100%", objectFit: "contain"
                }}
              />
              {/* 오버레이 */}
              <div style={{
                position: "absolute", top: 8, left: 12,
                background: "rgba(0,0,0,0.6)", borderRadius: 4,
                padding: "3px 8px", fontSize: 10, color: "#4CAF50"
              }}>
                LIVE
              </div>
            </div>
            {/* 하단 */}
            <div style={{ padding: "12px 16px", display: "flex", alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>{cam.name}</div>
                <div style={{ color: "#555", fontSize: 10, marginTop: 2 }}>
                  {new Date(cam.created_at).toLocaleString("ko-KR")}
                </div>
              </div>
              <button
                onClick={() => requestStream(cam.id)}
                style={{
                  background: "#f5c518", color: "#000", border: "none",
                  borderRadius: 6, padding: "8px 16px", fontSize: 12,
                  fontWeight: 700, cursor: "pointer"
                }}
              >
                연결
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 푸터 */}
      <div style={{
        textAlign: "center", color: "#333", fontSize: 10,
        marginTop: 40, padding: 20
      }}>
        Sungwon Station v1.0 — Powered by DodoStation
      </div>
    </div>
  );
}

export default App;
