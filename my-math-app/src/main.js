
// ==========================================
// 👑 시스템 관리자 및 권한 설정
// ==========================================
const ADMIN_EMAILS = [
    'kthblacks11@gmail.com' // 선생님 아이디 (기본 관리자) 주의 이때, 콤마(,) 넣기
    //'추가할선생님이메일@gmail.com' // 💡 필요시 이 란에 다른 선생님 이메일을 콤마로 연결하여 계속 추가하세요!
];

let currentUserRole = 'guest'; // 'admin'(관리자) 또는 'user'(일반 교사)
let currentUserGroup = 'math'; // 기본 교과군
// ==========================================

let currentEditingAssessmentIndex = -1;

const firebaseConfig = {
  apiKey: "AIzaSyD16bomCtDrDppZwDXKvInV9fvfww_qj00",
  authDomain: "math-secret-app.firebaseapp.com",
  projectId: "math-secret-app",
  storageBucket: "math-secret-app.firebasestorage.app",
  messagingSenderId: "703727718168",
  appId: "1:703727718168:web:b7a33b02d0cc2ae141d86d"
};



firebase.initializeApp(firebaseConfig);
// ==========================================
// 🛡️ 비로그인 사용자 전역 클릭 차단 (로그인 강제 유도 방어막)
// ==========================================
document.addEventListener('click', async (e) => {
    // 1. 이미 로그인된 상태면 무사 통과
    if (auth.currentUser) return;

    // 2. 로그인 버튼 자체를 누른 거면 패스 (로그인 진행을 막으면 안 되니까요!)
    if (e.target.closest('#login-btn')) return;

    // 3. 클릭한 곳이 버튼, 입력창, 탭, 카드 등 '기능을 하는 요소'인지 감지
    const isInteractive = e.target.closest('button, a, input, select, textarea, .card, .tab-btn, .group-btn, .check-item, .dict-accordion-header, .quiz-container');

    if (isInteractive) {
        // 원래 버튼이 하려던 동작(화면 이동 등)을 완벽하게 멈춤!
        e.preventDefault();
        e.stopPropagation(); 

        // 안내창 띄우고 즉시 구글 로그인 연결
        alert("구글로 로그인 후 이용할 수 있습니다.");
        setTimeout(async () => {
            try {
                await auth.signInWithPopup(provider);
            } catch (error) {
                console.error("로그인 실패 또는 취소:", error);
            }
        }, 10); 
    }
}, true); // 💡 true (캡처링): HTML의 가장 바깥에서 먼저 이벤트를 낚아채도록 설정!

const db = firebase.firestore();
db.enablePersistence()
  .catch((err) => {
      console.warn("오프라인 캐시 활성화 실패:", err.code);
  });
const auth = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();
const storage = firebase.storage();

const CURRENT_VERSION = "1.2.11"; 
// 2026년 8월 12일 수정처리됨
// 읽기 횟수를 절약하는 버전 체크 방식 (onSnapshot 대신 get 사용)
function startAppVersionCheck() {
    db.collection('system_config').doc('version_control').get()
      .then(doc => {
          if (doc.exists) {
              const serverVersion = doc.data().latest_version;

              // 💡 [여기에 추가!] 이미 새로고침을 시도한 버전이라면, 무한루프에 빠지지 않게 여기서 즉시 멈춤!
              if (sessionStorage.getItem('update_tried_for_' + serverVersion)) return;
              
              if (serverVersion && CURRENT_VERSION !== serverVersion) {
                  const currentHour = new Date().getHours();
                  const isDayTime = (currentHour >= 8 && currentHour <= 17);

                  if (isDayTime) {
                      const userWantsToUpdate = confirm(
                          "🚀 시스템이 업데이트되었습니다!\n지금 바로 새로고침 하시겠습니까?"
                      );
                      if (userWantsToUpdate) {
                        // 💡 추가: 새로고침 하기 전에 '이번 버전에 대해 새로고침을 눌렀음'을 기록
                        sessionStorage.setItem('update_tried_for_' + serverVersion, 'true');
                        window.location.reload(true); 
                    }
                } else {
                    // 일과 시간 외에는 묻지 않고 즉시 새로고침
                    sessionStorage.setItem('update_tried_for_' + serverVersion, 'true');
                    window.location.reload(true);
                }
            }
        }
    })
    .catch(err => {
        console.log("버전 체크 중 에러:", err);
    });
}


let currentUploadedImageUrl = null;
let feedbackUnsubscribe = null; // 💡 멈춤 현상(메모리 누수)을 막기 위한 필수 변수 추가

auth.onAuthStateChanged(async (user) => {
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const deleteAccountBtn = document.getElementById('delete-account-btn'); 
    const userInfo = document.getElementById('user-info');
    const adminFeedbackBtn = document.getElementById('admin-feedback-btn'); 
    const adminModeBtn = document.getElementById('admin-mode-btn'); 
    const curriculumSelector = document.querySelector('.curriculum-selector'); // 상단 교과 탭

    if (user) {
        if (!isDbLoaded && dbLoadPromise) {
            await dbLoadPromise;
        }
      
        // [공통 적용 UI]
        if(loginBtn) loginBtn.style.display = 'none';
        if(logoutBtn) logoutBtn.style.display = 'inline-block';
        if(deleteAccountBtn) deleteAccountBtn.style.display = 'inline-block'; 
        if(userInfo) userInfo.innerText = user.displayName + " 선생님 환영합니다.";
        startAppVersionCheck();
        if (typeof renderSavedAssessments === "function") {
            renderSavedAssessments(); 
        }

        // ✨ [핵심] 권한 분리: 관리자 vs 일반 교사
        if (ADMIN_EMAILS.includes(user.email)) {
            // ==========================================
            // 👑 관리자 모드 (모든 과목 접근 가능 + 알림 뱃지)
            // ==========================================
            currentUserRole = 'admin';
            if (curriculumSelector) curriculumSelector.style.display = 'flex'; // 상단 탭 켜기
            if (adminModeBtn) adminModeBtn.style.display = 'inline-block';

            // 👑 관리자 닉네임 체크 (최초 1회성)
            try {
                const adminDocRef = db.collection('user_profiles').doc(user.uid);
                const adminDoc = await adminDocRef.get();
                // 문서가 있고, 닉네임 필드가 존재하지 않을 때만 딱 한 번 실행
                if (adminDoc.exists && !adminDoc.data().hasOwnProperty('nickname')) {
                    await adminDocRef.set({ nickname: user.displayName || "관리자" }, { merge: true });
                    console.log("👑 관리자 닉네임 필드가 추가되었습니다.");
                }
            } catch (err) {
                console.error("관리자 닉네임 체크 에러:", err);
            }

            // 선생님이 작성하신 실시간 새 메시지 뱃지 로직 (완벽 보존!)
            if(adminFeedbackBtn) {
                adminFeedbackBtn.style.display = 'inline-block';
                adminFeedbackBtn.style.position = 'relative';
                
                if (feedbackUnsubscribe) feedbackUnsubscribe();
                
                feedbackUnsubscribe = db.collection('developer_feedback').onSnapshot(snapshot => {
                    let badge = document.getElementById('admin-fb-badge');
                    if (!badge) {
                        badge = document.createElement('span');
                        badge.id = 'admin-fb-badge';
                        badge.style.cssText = 'position: absolute; top: -8px; right: -8px; background: #ef4444; color: white; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.2);';
                        adminFeedbackBtn.appendChild(badge);
                    }
                    
                    const lastChecked = parseInt(localStorage.getItem('admin_last_checked_feedback') || "0");
                    let newCount = 0;
                    
                    snapshot.forEach(doc => {
                        const data = doc.data();
                        const msgTime = data.timestamp ? data.timestamp.toMillis() : Date.now();
                        if (msgTime > lastChecked) {
                            newCount++;
                        }
                    });
                    
                    if (newCount > 0) {
                        badge.innerText = newCount;
                        badge.style.display = 'flex';
                    } else {
                        badge.style.display = 'none';
                    }
                });
            }

            // 관리자는 기본 설정대로 화면 그리기
            initDashboard(); 
            if (typeof initChecklist === 'function') initChecklist(); 
            if (typeof populatePerformanceStandards === 'function') populatePerformanceStandards();
            if (typeof loadBookmark === 'function') loadBookmark(); 
            showSection('dashboard');

        } else {
            // ==========================================
            // 👩‍🏫 일반 교사 모드 (본인 과목만 접근 가능)
            // ==========================================
            currentUserRole = 'user';
            
            // 💡 [수정됨] 겉포장지(curriculumSelector)는 건드리지 않고, 교과 버튼들만 숨깁니다!
            document.querySelectorAll('.group-btn').forEach(btn => btn.style.display = 'none');
            
            if(adminFeedbackBtn) adminFeedbackBtn.style.display = 'none';
            if(adminModeBtn) adminModeBtn.style.display = 'none';

            try {
                const userDocRef = db.collection('user_profiles').doc(user.uid);
                const profileDoc = await userDocRef.get();

                if (profileDoc.exists && profileDoc.data().mainGroup) {
                    const userData = profileDoc.data();
                    
                    // 💡 [핵심 개선] 기존 사용자가 접속했을 때 닉네임 필드가 없으면 추가 (있으면 패스)
                    if (!userData.hasOwnProperty('nickname')) {
                        await userDocRef.set({
                            nickname: user.displayName || "사용자"
                        }, { merge: true });
                        console.log("👩‍🏫 기존 유저 닉네임 필드가 추가되었습니다.");
                    }

                    currentUserGroup = userData.mainGroup;
                    changeGroup(currentUserGroup);
                    
                    initDashboard();
                    if (typeof initChecklist === 'function') initChecklist(); 
                    if (typeof loadBookmark === 'function') loadBookmark(); 
                    showSection('dashboard');
                } else {
                    document.getElementById('subject-selection-modal').style.display = 'flex';
                }
            } catch (e) {
                console.error("프로필 로딩 에러:", e);
            }
        }
        
    } else {
        // ==========================================
        // 🚪 로그아웃 상태 처리
        // ==========================================
        if(loginBtn) loginBtn.style.display = 'inline-block';
        if(logoutBtn) logoutBtn.style.display = 'none';
        if(deleteAccountBtn) deleteAccountBtn.style.display = 'none'; 
        if(userInfo) userInfo.innerText = "로그인이 필요합니다.";
        
        if(adminFeedbackBtn) adminFeedbackBtn.style.display = 'none';
        if(adminModeBtn) adminModeBtn.style.display = 'none';
        
        // 로그아웃 시 팝업창 닫기 및 뱃지 감시기 끄기
        document.getElementById('subject-selection-modal').style.display = 'none';
        if (feedbackUnsubscribe) { feedbackUnsubscribe(); feedbackUnsubscribe = null; }
    }
});

function showApiModal() {
    const modal = document.getElementById('api-modal'); 
    if(modal) modal.style.display = 'flex';
}

async function handleLogin() {
    try { await auth.signInWithPopup(provider); }
    catch (error) { alert("로그인에 실패했습니다."); }
}

function handleLogout() {
    if(confirm("로그아웃 하시겠습니까?")) { auth.signOut(); }
}

// ✨ 진짜 데이터를 말끔히 지워주는 완벽한 회원 탈퇴 기능
async function handleDeleteAccount() {
    const user = firebase.auth().currentUser;
    
    if (!user) {
        alert("로그인 상태가 아닙니다.");
        return;
    }
    
    if (confirm("정말로 탈퇴하시겠습니까?\n탈퇴하시면 시스템에 저장된 모든 선생님의 개인 데이터(프로필, 수업일지, 체크리스트, 내가 만든 폴더)가 즉시 삭제되며 복구할 수 없습니다.")) {
        try {
            const uid = user.uid;
            const email = user.email;

            // 1. 내 개인 정보 데이터 삭제 (프로필, 체크리스트, 수업일지)
            await db.collection('user_profiles').doc(uid).delete();
            await db.collection('user_checklists').doc(uid).delete();
            await db.collection('user_journals').doc(uid).delete();

            // 2. 내가 방장(ownerEmail)으로 만든 폴더(프로젝트) 일괄 삭제
            const projectsSnapshot = await db.collection('user_projects').where('ownerEmail', '==', email).get();
            const batch = db.batch(); // 여러 개를 한 번에 지우는 마법의 빗자루
            projectsSnapshot.forEach(doc => {
                batch.delete(doc.ref);
            });
            await batch.commit();

            // 3. 찌꺼기 데이터를 모두 비웠으니, 마지막으로 내 계정(Auth) 폭파!
            await user.delete();
            
            alert("회원 탈퇴 및 개인 데이터 삭제가 완벽하게 완료되었습니다. 이용해 주셔서 감사합니다.");
            window.location.reload(); 
        } catch (error) {
            if (error.code === 'auth/requires-recent-login') {
                alert("안전한 탈퇴 처리를 위해 재로그인이 필요합니다.\n로그아웃 후 다시 로그인하여 탈퇴를 진행해 주세요.");
            } else {
                alert("탈퇴 처리 중 오류가 발생했습니다: " + error.message);
            }
        }
    }
}

let currentSubject = "common2";
let currentStandardCode = null;
let currentLevelQ = 0;
let currentQuestions = [];
let selectedFile = null;
let currentChatContext = ""; 
let lastAnalyzedSingleImage = null; 

let analysisMainMode = 'single'; 
let singleCropMode = 'single'; 
let cropBoxes = []; 
let isInteracting = false; 
let interactionType = null; 
let activeBoxIndex = -1;
let dragStartX = 0, dragStartY = 0;
let initialBoxState = null;
let lastBatchDiff = '상'; // 일괄넣기 난이도 기억용 변수

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// ✨ AI 기능을 쓸 때만 API 키가 있는지 검사하는 스마트 검문소
function requireApiKey() {
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
        if (confirm("🤖 AI 기능을 사용하려면 구글 Gemini API 키 등록이 필요합니다.\n지금 'API 가져오기' 설정창을 열어 키를 등록하시겠습니까?")) {
            openSettings(); 
        }
        return false; // 키가 없으니 기능 실행을 잠시 멈춤(false)
    }
    return true; // 키가 있으니 기능 실행 통과!(true)
}

async function openSettings() { 
    const isLoggedIn = await checkLogin();
    if (!isLoggedIn) return;
    document.getElementById('api-key-input').value = localStorage.getItem('gemini_api_key') || "";
    document.getElementById('settings-modal').style.display = 'flex'; 
}
function closeSettings() { document.getElementById('settings-modal').style.display = 'none'; }
function openFeedback() { document.getElementById('feedback-modal').style.display = 'flex'; }
function closeFeedback() { document.getElementById('feedback-modal').style.display = 'none'; }
function closeModal() { document.getElementById('level-modal').style.display = 'none'; }
function closeAdminFeedback() { document.getElementById('admin-feedback-modal').style.display = 'none'; }

function saveApiKey() {
    const key = document.getElementById('api-key-input').value.trim();
    if (key) {
        localStorage.setItem('gemini_api_key', key);
        alert("API 키가 기기에 안전하게 저장되었습니다.");
        closeSettings();
    }
}

async function submitFeedback() {
    const text = document.getElementById('feedback-message').value.trim();
    if(!text) { alert("의견을 입력해주세요!"); return; }
    const submitBtn = document.querySelector('#feedback-modal .save-btn');
    submitBtn.disabled = true;
    submitBtn.innerText = "전송 중...";

    const user = auth.currentUser;
    const userEmail = user ? user.email : "이메일 정보 없음";

    try {
        await db.collection('developer_feedback').add({
            text: text, 
            user_email: userEmail, 
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        alert("의견이 성공적으로 전송되었습니다. 감사합니다!");
        document.getElementById('feedback-message').value = "";
    } catch(e) {
        let pending = JSON.parse(localStorage.getItem('pending_feedback')) || [];
        pending.push({ text: text, user_email: userEmail, time: new Date().toISOString() });
        localStorage.setItem('pending_feedback', JSON.stringify(pending));
        alert("현재 서버 통신이 원활하지 않아 의견이 임시 저장되었습니다.");
        document.getElementById('feedback-message').value = "";
    } finally {
        submitBtn.disabled = false; submitBtn.innerText = "의견 전송하기"; closeFeedback(); 
    }
}

// ✨ 2. 관리자 의견 확인창을 렌더링하는 함수 (뱃지 초기화 기능 탑재)
async function openAdminFeedback() {
    const user = auth.currentUser;
    const adminEmail = "kthblacks11@gmail.com"; 
    if (!user) { alert("먼저 구글 로그인을 해주세요."); return; }
    if (user.email !== adminEmail) { alert("관리자 계정만 접근할 수 있습니다."); return; }

    // 💡 [핵심 추가] 창을 열면 '마지막 확인 시간'을 갱신하고 뱃지를 숨김!
    localStorage.setItem('admin_last_checked_feedback', Date.now().toString());
    const badge = document.getElementById('admin-fb-badge');
    if (badge) badge.style.display = 'none';

    document.getElementById('admin-feedback-modal').style.display = 'flex';
    const listEl = document.getElementById('admin-feedback-list');
    listEl.innerHTML = "<p style='text-align:center; padding: 2rem;'>의견 목록을 불러오는 중...</p>";
    
    try {
        const snapshot = await db.collection('developer_feedback').orderBy('timestamp', 'desc').get();
        if(snapshot.empty) { listEl.innerHTML = "<p style='text-align:center; color:#64748b;'>아직 접수된 의견이 없습니다.</p>"; return; }
        let html = "";
        
        snapshot.forEach(doc => {
            const data = doc.data();
            const date = data.timestamp ? data.timestamp.toDate().toLocaleString() : "방금 전";

            const senderEmail = data.user_email || "이메일 정보 없음";
            
            if (data.type === "문항 매칭 이의 제기") {
                let aiReviewText = data.ai_review || "";
                
                // ✨ AI의 응답에서 태그별로 데이터 추출
                let reviewResult = aiReviewText.match(/\[검토결과\]:\s*([\s\S]*?)(?=\[최종|$)/)?.[1]?.trim() || "검토 결과를 파싱하지 못했습니다.";
                let finalStd = aiReviewText.match(/\[최종성취기준\]:\s*([^\n]+)/)?.[1]?.trim() || data.proposed_standard;
                let finalLvl = aiReviewText.match(/\[최종성취수준\]:\s*([A-E])/)?.[1]?.trim() || data.proposed_level;
                let finalAns = aiReviewText.match(/\[최종정답\]:\s*([^\n]+)/)?.[1]?.trim() || "";
                let finalReason = aiReviewText.match(/\[최종판정이유\]:\s*([\s\S]*)/)?.[1]?.trim() || data.teacher_reason;

                html += `<div style="background: white; padding: 1.2rem; border-radius: 8px; margin-bottom: 1.2rem; border-left: 4px solid #ea580c; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                                <span style="background: #ffedd5; color: #c2410c; padding: 3px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: bold;">🙋 판정 이의 제기</span>
                                <span style="background: #f1f5f9; color: #475569; padding: 3px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: bold;">👤 ${senderEmail}</span>
                                </div>
                                <span style="font-size:0.8rem; color:var(--text-light); font-weight:bold;">🕒 ${date}</span>
                            </div>
                            <div style="background: #f8fafc; padding: 10px; border-radius: 6px; font-size: 0.9rem; margin-bottom: 10px; border: 1px solid #e2e8f0; line-height: 1.5;">
                                <strong style="color:#1e40af;">[원본 문항]</strong><br>${data.question}
                            </div>
                            
                            <div style="margin-bottom: 10px; font-size: 0.9rem;">
                                <strong style="color: #475569;">👨‍🏫 선생님 이의 제기 사유:</strong>
                                <p style="margin: 5px 0 0 0; background: #f1f5f9; padding: 10px; border-radius: 6px; line-height: 1.5;">[제안: ${data.proposed_standard} / ${data.proposed_level}수준] ${data.teacher_reason}</p>
                            </div>

                            <div style="font-size: 0.9rem; margin-bottom: 10px;">
                                <strong style="color: #6d28d9;">🤖 AI 수석 위원 검토 결과:</strong>
                                <p style="margin: 5px 0 0 0; background: #f5f3ff; padding: 10px; border-radius: 6px; border: 1px solid #ddd6fe; color: #4c1d95; line-height: 1.6; font-weight: 500;">${reviewResult}</p>
                            </div>

                            <div style="background: #dcfce7; padding: 12px; border-radius: 6px; border: 1px solid #bbf7d0; font-size: 0.85rem;">
                                <strong style="color: #15803d; font-size: 0.95rem;">✅ 최종 반영할 판정 (AI 도출 결과 / 수정 가능)</strong>
                                <div style="margin-top: 10px; display: flex; align-items: center; gap: 5px;">
                                    <span style="font-weight:bold; width:40px;">기준:</span> <input type="text" id="admin-prop-std-${doc.id}" value="${finalStd}" style="flex: 1; padding: 5px; border: 1px solid #86efac; border-radius: 4px;">
                                </div>
                                <div style="margin-top: 5px; display: flex; align-items: center; gap: 5px;">
                                    <span style="font-weight:bold; width:40px;">수준:</span> <select id="admin-prop-lvl-${doc.id}" style="flex: 1; padding: 5px; border: 1px solid #86efac; border-radius: 4px;">
                                        <option value="A" ${finalLvl==='A'?'selected':''}>A</option>
                                        <option value="B" ${finalLvl==='B'?'selected':''}>B</option>
                                        <option value="C" ${finalLvl==='C'?'selected':''}>C</option>
                                        <option value="D" ${finalLvl==='D'?'selected':''}>D</option>
                                        <option value="E" ${finalLvl==='E'?'selected':''}>E</option>
                                    </select>
                                </div>
                                <div style="margin-top: 5px; display: flex; align-items: center; gap: 5px;">
                                    <span style="font-weight:bold; width:40px;">정답:</span> <input type="text" id="admin-prop-ans-${doc.id}" value="${finalAns}" placeholder="정답 입력 (수식 $ 사용)" style="flex: 1; padding: 5px; border: 1px solid #86efac; border-radius: 4px;">
                                </div>
                                <div style="margin-top: 5px; display: flex; align-items: flex-start; gap: 5px;">
                                    <span style="font-weight:bold; width:40px; margin-top:5px;">이유:</span> <textarea id="admin-prop-reason-${doc.id}" rows="3" style="flex: 1; padding: 5px; border: 1px solid #86efac; border-radius: 4px; font-family:inherit;">${finalReason}</textarea>
                                </div>
                            </div>
                            
                            <div style="display: flex; gap: 10px; margin-top: 15px; border-top: 1px dashed #cbd5e1; padding-top: 15px;">
                                <button onclick="acceptFeedback('${doc.id}')" style="background: #10b981; color: white; border: none; flex: 1; padding: 0.8rem; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.95rem;">✅ 위 내용으로 DB 즉시 수정</button>
                                <button onclick="rejectFeedback('${doc.id}')" style="background: #ef4444; color: white; border: none; flex: 1; padding: 0.8rem; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.95rem;">❌ 기각 (의견 삭제)</button>
                            </div>
                         </div>`;
            } else {
                // 일반 피드백 창 로직
                html += `<div style="background: white; padding: 1.2rem; border-radius: 8px; margin-bottom: 1.2rem; border-left: 4px solid var(--primary); box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                                <span style="background: #e0e7ff; color: #1e40af; padding: 3px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: bold;">💡 일반 의견</span>
                                <span style="background: #f1f5f9; color: #475569; padding: 3px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: bold;">👤 ${senderEmail}</span>
                                </div>
                                <span style="font-size:0.8rem; color:var(--text-light); font-weight:bold;">🕒 ${date}</span>
                            </div>
                            <p style="margin:0; font-size:0.95rem; white-space:pre-wrap; line-height:1.5;">${data.text || "내용 없음"}</p>
                            <div style="text-align: right; margin-top: 10px;">
                                <button onclick="rejectFeedback('${doc.id}')" style="background: #ef4444; color: white; border: none; padding: 0.4rem 0.8rem; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">삭제</button>
                            </div>
                         </div>`;
            }
        });
        listEl.innerHTML = html;
        if (window.MathJax) MathJax.typesetPromise([listEl]).catch(err => console.error(err));
    } catch(e) { listEl.innerHTML = "<p style='color:red;'>데이터 로드 실패.</p>"; }
}

function handleImageUpload(event) {
    selectedFile = event.target.files[0];
    displayPreview(selectedFile);
}

function handlePaste(event) {
    const activeTag = document.activeElement.tagName.toLowerCase();
    if (activeTag === 'input' || activeTag === 'textarea') {
        return; 
    }    
    const items = (event.clipboardData || event.originalEvent.clipboardData).items;
    for (let index in items) {
        const item = items[index];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
            selectedFile = item.getAsFile();
            displayPreview(selectedFile);
            
            // 🟢 [버그 해결 핵심 2] 현재 탭이 'problem-analysis'가 아닐 때만 탭 이동을 시도합니다.
            const currentActive = document.querySelector('.section.active');
            if (!currentActive || currentActive.id !== 'problem-analysis') {
                showSection('problem-analysis');
            }
            break;
        }
    }
}

function openAnalysisMode(mode) {
    showSection('problem-analysis');
    analysisMainMode = mode;
    resetAnalysis(); 

    const currentBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick').includes(`openAnalysisMode('${mode}')`));
    if (currentBtn) {
        currentBtn.classList.add('active');
    }

    const title = document.getElementById('analysis-title');
    const summary = document.getElementById('service-summary');

    if (mode === 'single') {
        title.innerHTML = "🔍 한 문제 상세 분석";
        summary.innerHTML = `
            <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 0.85rem; color: #334155;">
                <div style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
                    <strong style="color: #2563eb; white-space: nowrap;">[상세 분석 제공 내용]</strong>
                    <span style="line-height: 1.5;">과목, 단원명, 성취기준, 성취수준, 판정이유, 핵심개념, 단계별 문제풀이</span>
                </div>
                <div style="display: flex; align-items: center; gap: 4px; color: #e11d48; font-weight: bold; padding-top: 5px; border-top: 1px solid #e2e8f0;">
                    <span>⚠️ AI 분석은 오류 가능성이 있으므로 교사의 최종 검토가 필수입니다.</span>
                </div>
            </div>`;
    } else {
        title.innerHTML = "📑 여러 문제 요약 분석";
        summary.innerHTML = `
            <div style="padding: 12px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; font-size: 0.85rem; color: #334155;">
                <div style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
                    <strong style="white-space: nowrap;">[요약 분석 제공 내용]</strong>
                    <span>문항별 과목, 단원명, 성취기준, 성취수준, 판정이유</span>
                </div>
                <div style="display: flex; align-items: center; gap: 4px; color: #e11d48; font-weight: bold; padding-top: 5px; border-top: 1px solid #e2e8f0;">
                    <span>⚠️ AI 분석은 오류 가능성이 있으므로 교사의 최종 검토가 필수입니다.</span>
                </div>
            </div>`;
    }
}

function displayPreview(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const imgEl = document.getElementById('image-preview');
        imgEl.src = e.target.result;
        imgEl.onload = function() {
            document.getElementById('preview-container').style.display = 'block';
            document.getElementById('upload-placeholder').style.display = 'none';
            
            if (analysisMainMode === 'single') {
                document.getElementById('single-mode-ui').style.display = 'block';
                document.getElementById('crop-canvas').style.display = 'none'; 
            } else {
                document.getElementById('multi-mode-ui').style.display = 'block';
                document.getElementById('crop-canvas').style.display = 'block'; 
                document.getElementById('crop-msg').style.display = 'block'; 
                initCropCanvas();
            }
        }
    }
    reader.readAsDataURL(file);
}

function setAnalysisMode(mode) {
    singleCropMode = mode;
    const canvas = document.getElementById('crop-canvas');
    const analyzeBtn = document.getElementById('analyze-single-btn');

    if (mode === 'single') {
        canvas.style.display = 'none';
        analyzeBtn.style.display = 'block';
        analyzeBtn.innerText = "✨ 사진 전체 분석 시작";
        cropBoxes = [];
    } else {
        canvas.style.display = 'block';
        analyzeBtn.style.display = 'none';
        initCropCanvas();
        if(document.getElementById('crop-msg')) document.getElementById('crop-msg').style.display = 'block';
    }
}

function normalizeBox(b) {
    return {
        x: b.w < 0 ? b.x + b.w : b.x,
        y: b.h < 0 ? b.y + b.h : b.y,
        w: Math.abs(b.w),
        h: Math.abs(b.h)
    };
}

function checkHit(x, y) {
    const TOLERANCE = 10; 
    for (let i = cropBoxes.length - 1; i >= 0; i--) {
        const b = normalizeBox(cropBoxes[i]);
        const nearL = Math.abs(x - b.x) < TOLERANCE;
        const nearR = Math.abs(x - (b.x + b.w)) < TOLERANCE;
        const nearT = Math.abs(y - b.y) < TOLERANCE;
        const nearB = Math.abs(y - (b.y + b.h)) < TOLERANCE;
        const insideX = x >= b.x && x <= b.x + b.w;
        const insideY = y >= b.y && y <= b.y + b.h;

        if (nearT && nearL) return { type: 'resize_nw', index: i };
        if (nearT && nearR) return { type: 'resize_ne', index: i };
        if (nearB && nearL) return { type: 'resize_sw', index: i };
        if (nearB && nearR) return { type: 'resize_se', index: i };
        if (nearT && insideX) return { type: 'resize_n', index: i };
        if (nearB && insideX) return { type: 'resize_s', index: i };
        if (nearL && insideY) return { type: 'resize_w', index: i };
        if (nearR && insideY) return { type: 'resize_e', index: i };
        if (insideX && insideY) return { type: 'move', index: i };
    }
    return null;
}

function initCropCanvas() {
    const imgEl = document.getElementById('image-preview');
    const canvas = document.getElementById('crop-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = imgEl.clientWidth;
    canvas.height = imgEl.clientHeight;

    drawOverlay();

    function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: clientX - rect.left, y: clientY - rect.top };
    }

    canvas.onmousedown = canvas.ontouchstart = (e) => {
        e.preventDefault();
        const pos = getPos(e);
        const hit = checkHit(pos.x, pos.y);
        if(document.getElementById('crop-msg')) document.getElementById('crop-msg').style.display = 'none';

        if (hit) { 
            isInteracting = true;
            interactionType = hit.type;
            activeBoxIndex = hit.index;
            dragStartX = pos.x; dragStartY = pos.y;
            initialBoxState = { ...cropBoxes[activeBoxIndex] };
        } else { 
            if (analysisMainMode === 'single') cropBoxes = []; 
            const newBox = { x: pos.x, y: pos.y, w: 0, h: 0 };
            cropBoxes.push(newBox);
            activeBoxIndex = cropBoxes.length - 1;
            isInteracting = true;
            interactionType = 'create';
            dragStartX = pos.x; dragStartY = pos.y;
        }
        drawOverlay();
    };

    canvas.onmousemove = canvas.ontouchmove = (e) => {
        e.preventDefault();
        const pos = getPos(e);

        if (!isInteracting) {
            const hit = checkHit(pos.x, pos.y);
            if (hit) {
                if (hit.type === 'move') canvas.style.cursor = 'move';
                else if (['resize_n', 'resize_s'].includes(hit.type)) canvas.style.cursor = 'ns-resize';
                else if (['resize_e', 'resize_w'].includes(hit.type)) canvas.style.cursor = 'ew-resize';
                else if (['resize_nw', 'resize_se'].includes(hit.type)) canvas.style.cursor = 'nwse-resize';
                else if (['resize_ne', 'resize_sw'].includes(hit.type)) canvas.style.cursor = 'nesw-resize';
            } else canvas.style.cursor = 'crosshair';
            return;
        }

        const dx = pos.x - dragStartX;
        const dy = pos.y - dragStartY;
        const box = cropBoxes[activeBoxIndex];

        if (interactionType === 'create') {
            box.w = pos.x - box.x; box.h = pos.y - box.y;
        } else if (interactionType === 'move') {
            box.x = initialBoxState.x + dx; box.y = initialBoxState.y + dy;
        } else {
            if (interactionType.includes('n')) { box.y = initialBoxState.y + dy; box.h = initialBoxState.h - dy; }
            if (interactionType.includes('s')) { box.h = initialBoxState.h + dy; }
            if (interactionType.includes('w')) { box.x = initialBoxState.x + dx; box.w = initialBoxState.w - dx; }
            if (interactionType.includes('e')) { box.w = initialBoxState.w + dx; }
        }
        drawOverlay();
    };

    canvas.onmouseup = canvas.onmouseout = canvas.ontouchend = (e) => {
        if (!isInteracting) return;
        isInteracting = false;
        
        cropBoxes = cropBoxes.map(normalizeBox).filter(b => b.w > 20 && b.h > 20);
        
        if (cropBoxes.length > 0) {
            if (analysisMainMode === 'single') {
                document.getElementById('analyze-single-btn').style.display = 'block';
                document.getElementById('analyze-single-btn').innerText = "🔍 선택 영역 분석 시작";
            } else {
                document.getElementById('analyze-multi-btn').style.display = 'block';
                if(document.getElementById('crop-count')) document.getElementById('crop-count').innerText = `${cropBoxes.length}개 영역 지정됨`;
            }
        } else {
            if(document.getElementById('crop-msg')) document.getElementById('crop-msg').style.display = 'block';
            if(analysisMainMode === 'single') document.getElementById('analyze-single-btn').style.display = 'none';
            else document.getElementById('analyze-multi-btn').style.display = 'none';
            if(document.getElementById('crop-count')) document.getElementById('crop-count').innerText = `0개 영역 지정됨`;
        }
        drawOverlay();
    };
}

function drawOverlay() {
    const canvas = document.getElementById('crop-canvas');
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'; 
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    cropBoxes.forEach((box, index) => {
        const nb = normalizeBox(box);
        
        ctx.clearRect(nb.x, nb.y, nb.w, nb.h);
        
        ctx.strokeStyle = '#3b82f6'; 
        ctx.lineWidth = 3;
        ctx.strokeRect(nb.x, nb.y, nb.w, nb.h);

        if (analysisMainMode === 'multi') {
            const badgeRadius = 10;
            const badgeX = nb.x + nb.w; 
            const badgeY = nb.y;        
            
            ctx.fillStyle = '#ef4444'; 
            ctx.beginPath();
            ctx.arc(badgeX, badgeY, badgeRadius, 0, 2 * Math.PI);
            ctx.fill();
            
            ctx.fillStyle = 'white';
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText((index + 1).toString(), badgeX, badgeY);
        }
    });
}

function getCroppedBase64(boxObj) {
    const imgEl = document.getElementById('image-preview');
    if (!boxObj) return imgEl.src.split(',')[1]; 
    
    const nb = normalizeBox(boxObj);
    const scaleX = imgEl.naturalWidth / imgEl.clientWidth;
    const scaleY = imgEl.naturalHeight / imgEl.clientHeight;
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = nb.w * scaleX; 
    tempCanvas.height = nb.h * scaleY;
    tempCanvas.getContext('2d').drawImage(
        imgEl, 
        nb.x * scaleX, nb.y * scaleY, nb.w * scaleX, nb.h * scaleY, 
        0, 0, tempCanvas.width, tempCanvas.height
    );
    return tempCanvas.toDataURL('image/jpeg', 0.9).split(',')[1];
}

// 🟢 업로드된 문제 이미지를 삭제하는 함수
function removePreviewImage(e) {
    if(e) e.stopPropagation();
    // true를 넘겨주어 지문 보관함(passages) 데이터는 보호하고 문제 이미지만 깔끔하게 지웁니다!
    resetAnalysis(true);
}

function resetAnalysis(keepPassages = false) {
    const probImg = document.getElementById('problem-image');
    if(probImg) probImg.value = "";
    
    const prevContainer = document.getElementById('preview-container');
    if(prevContainer) prevContainer.style.display = 'none';
    
    const uploadPlaceholder = document.getElementById('upload-placeholder');
    if(uploadPlaceholder) uploadPlaceholder.style.display = 'block';
    
    if(document.getElementById('single-mode-ui')) document.getElementById('single-mode-ui').style.display = 'none';
    if(document.getElementById('multi-mode-ui')) document.getElementById('multi-mode-ui').style.display = 'none';
    if(document.getElementById('analyze-single-btn')) document.getElementById('analyze-single-btn').style.display = 'none';
    if(document.getElementById('analyze-multi-btn')) document.getElementById('analyze-multi-btn').style.display = 'none';
    
    const analysisResult = document.getElementById('analysis-result');
    if(analysisResult) analysisResult.style.display = 'none';
    
    const cropCanvas = document.getElementById('crop-canvas');
    if(cropCanvas) cropCanvas.style.display = 'none';

    cropBoxes = [];
    const cropCount = document.getElementById('crop-count');
    if(cropCount) cropCount.innerText = "0개 영역 지정됨";
    
    const chatContainer = document.getElementById('ai-chat-container');
    if(chatContainer) {
        chatContainer.style.display = 'none';
        chatContainer.style.position = 'relative'; 
        chatContainer.style.width = '280px';
        
        const chatHistory = document.getElementById('chat-history');
        if(chatHistory) chatHistory.innerHTML = "";
        currentChatContext = ""; 
    }

    // 고정되었던 문제 패널 해제
    const wrapper = document.getElementById('analysis-layout-wrapper');
    if (wrapper) {
        wrapper.style.position = 'relative'; 
        wrapper.style.display = 'block'; 
    }

    const mainContainer = document.querySelector('.container');
    if (mainContainer) {
        mainContainer.style.maxWidth = ''; 
    }

    // 🟢 [핵심] 완전히 새로 시작할 때만(keepPassages가 false일 때만) 
    // 보관함 창을 닫고 데이터를 깨끗하게 비웁니다.
    // 🟢 [핵심] 완전히 새로 시작할 때만 보관함 창을 닫습니다.
    if (keepPassages !== true) {
        const tray = document.getElementById('common-passage-tray');
        const icon = document.getElementById('tray-icon');
        if (tray) tray.style.display = 'none';
        if (icon) icon.innerText = '📚';

        // 💡 선생님 요청 반영: 지문 보관함이 이미 '비어있을 때만' 내부 배열을 청소합니다.
        // (수학 등 다른 교과 작업 시에는 어차피 비어있으므로 안전하게 청소됨)
        if (typeof commonPassages === 'undefined' || commonPassages.length === 0) {
            commonPassages = [];
            if(document.getElementById('passage-thumbnails')) document.getElementById('passage-thumbnails').innerHTML = '';
        }
    }
} // <-- resetAnalysis 함수 끝

async function checkApiError(response) {
    if (!response.ok) {
        let errMsg = "";
        try {
            const errData = await response.json();
            errMsg = errData.error?.message || "";
        } catch(e) {
            errMsg = response.statusText;
        }
        
        let koreanError = "서버와 통신 중 알 수 없는 문제가 발생했습니다.";
        
        if (response.status === 400) {
            if (errMsg.includes("API key not valid")) koreanError = "입력하신 API 키가 유효하지 않습니다. 키를 다시 확인해주세요.";
            else koreanError = "이미지나 요청 형식이 잘못되었습니다. 다시 업로드해주세요.";
        }
        else if (response.status === 401 || response.status === 403) koreanError = "입력하신 API 키가 잘못되었거나 권한이 없습니다. API 키를 다시 확인해주세요!";
        else if (response.status === 404) koreanError = "AI 모델 버전을 찾을 수 없습니다. (시스템 관리자에게 문의하세요)";
        else if (response.status === 429 || errMsg.includes("quota") || errMsg.includes("RESOURCE_EXHAUSTED")) koreanError = "무료 사용량(할당량) 한도를 초과했습니다! ⚙️설정에서 새로운 API 키를 발급받아 입력해주세요.";
        else if (response.status === 500) koreanError = "구글 AI 서버 내부에서 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
        else if (response.status === 503 || errMsg.includes("high demand") || errMsg.includes("overloaded")) koreanError = "현재 구글 서버에 접속자가 너무 많아 일시적으로 바쁩니다! 10초만 기다렸다가 다시 눌러주세요.";

        throw new Error(koreanError);
    }
}

async function executeAnalysis() {
    const isLoggedIn = await checkLogin();
    if (!isLoggedIn) return;

    if (!requireApiKey()) return;

    if(document.getElementById('single-mode-ui')) document.getElementById('single-mode-ui').style.display = 'none';
    if(document.getElementById('multi-mode-ui')) document.getElementById('multi-mode-ui').style.display = 'none';
    document.getElementById('crop-canvas').style.display = 'none';
    
    const resultDiv = document.getElementById('analysis-result');
    const resultText = document.getElementById('result-text');
    resultDiv.style.display = 'block';
    
    resultText.innerHTML = '<div style="text-align:center; padding: 3rem; color: #3b82f6; font-weight: bold; font-size: 1.1rem;">AI 교사가 국가 수준 평가 루브릭을 바탕으로 정밀 분석 중입니다... ⏳</div>';
    resultDiv.scrollIntoView({ behavior: 'smooth' });

    try {
        let standardsInfo = "";
        for (const key in subjectData) {
            if (subjectData[key].standards && subjectData[key].standards.length > 0) {
                standardsInfo += `\n--- ${subjectData[key].title} ---\n`;
                standardsInfo += subjectData[key].standards.map(s => `${s.code} ${s.desc}`).join('\n');
            }
        }
        const referenceDBText = await fetchReferenceQuestions(currentSubject);

        let isSingleMode = (analysisMainMode === 'single');
        const userApiKey = localStorage.getItem('gemini_api_key');

        let bodyData = {
            standardsInfo: standardsInfo,
            subject: currentSubject,
            referenceDBText: referenceDBText,
            commonImages: commonPassages,
            apiKey: userApiKey
        };

        if (isSingleMode) {
            bodyData.action = "analyze_single";
            const box = (singleCropMode === 'multi' && cropBoxes.length > 0) ? cropBoxes[0] : null;
            lastAnalyzedSingleImage = getCroppedBase64(box);
            bodyData.imageBase64 = lastAnalyzedSingleImage;
        } else {
            bodyData.action = "analyze_multi";
            bodyData.images = cropBoxes.map(box => getCroppedBase64(box));
        }

        const workerUrl = "https://script.google.com/macros/s/AKfycbwgx4RgF8FQxxL3jBgEQ5l369llADjhZ1NepulIdF4DdX18kBrB8oRQ4Ft0d5WdKtEF/exec";
        const response = await fetch(workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(bodyData)
        });

        if (!response.ok) {
            const errData = await response.json();
            const realError = errData.error?.message || errData.error || "알 수 없는 서버 오류";
            throw new Error(`[서버 상세 에러] ${realError}`);
        }
        
        const data = await response.json();
        if (data.error) {
            let errMsg = data.error.message || "";
            let koreanError = "구글 AI가 응답을 거부했습니다.";
            
            if (errMsg.includes("API key not valid")) koreanError = "입력하신 API 키가 유효하지 않습니다. 키를 다시 확인해주세요.";
            else if (errMsg.includes("models/") || errMsg.includes("not found")) koreanError = "AI 모델 버전을 찾을 수 없습니다. 백엔드의 모델명을 확인해주세요.";
            else if (errMsg.includes("quota") || errMsg.includes("RESOURCE_EXHAUSTED")) koreanError = "무료 사용량(할당량) 한도를 초과했습니다! API 키를 새로 발급받아 갱신해주세요.";
            else if (errMsg.includes("high demand") || errMsg.includes("overloaded")) koreanError = "현재 구글 서버에 접속자가 많아 지연되고 있습니다. 잠시 후 다시 시도해주세요.";
            else koreanError = "AI 분석 오류: " + errMsg;

            throw new Error(koreanError);
        }
        const analysisText = data.candidates[0].content.parts[0].text;
        
        currentChatContext = analysisText;

        const wrapper = document.getElementById('analysis-layout-wrapper');
        if (wrapper) { wrapper.style.position = 'relative'; wrapper.style.display = 'block'; }

        const chatContainer = document.getElementById('ai-chat-container');
        if(chatContainer) {
            chatContainer.style.display = 'flex';
            chatContainer.style.position = 'absolute';
            chatContainer.style.right = '-200px';      
            chatContainer.style.top = '0';            
            chatContainer.style.width = '350px';
            chatContainer.style.height = 'fit-content';
            chatContainer.style.paddingBottom = '1rem';
            chatContainer.style.zIndex = '100';        
            chatContainer.style.backgroundColor = 'white';
            chatContainer.style.border = '1px solid #cbd5e1';
            chatContainer.style.borderRadius = '12px';
            chatContainer.style.boxShadow = '-5px 0 15px rgba(0,0,0,0.1)';
        }
        
        // [원래 렌더링 유지] 1. 텍스트 및 HTML DOM 렌더링
        if (isSingleMode) {
            renderSophisticatedResult(analysisText, lastAnalyzedSingleImage);
            
            // 🌟 [자동 저장 - 단일 상세 분석] 파싱 후 즉시 트리거 실행
            const qTxtMatch = analysisText.match(/(?:\[원본 문제 추출\]:?)([\s\S]*?)(?=\[교과|$)/);
            const stdMatch = analysisText.match(/(?:성취기준:?\s*\[?)([^\]\n\s,]+)/);
            const lvMatch = analysisText.match(/(?:성취수준:?\s*)([A-E]\+?)/);
            const rsMatch = analysisText.match(/(?:판정 이유:?\s*)([\s\S]*?)(?=\[핵심|$)/);

            let pureQ = qTxtMatch ? qTxtMatch[1].trim() : "단일 문항 추출 실패";
            let rawCodes = "";
            
            const rawStdLine = analysisText.match(/(?:성취기준:?\s*)([^\n]+)/);
            if (rawStdLine) rawCodes = rawStdLine[1].trim();

            let pureLv = lvMatch ? lvMatch[1].trim() : "C";
            let pureRs = rsMatch ? rsMatch[1].trim() : "자동 수집된 평가 세부 내역";

            // 💡 [핵심 복구] 마지막 파라미터로 commonPassages(지문 이미지 배열)를 던져주어 100% 유실 없이 저장되게 합니다.
            await saveAnalysisAutomatically(pureQ, rawCodes || "미분류", pureLv, pureRs, lastAnalyzedSingleImage, commonPassages);
            
        } else {
            let rawText = analysisText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
            
            rawText = rawText.replace(/\[문항\s*(\d+)\]/g, (match, p1) => {
                const idx = parseInt(p1) - 1;
                const imgBase64 = cropBoxes[idx] ? getCroppedBase64(cropBoxes[idx]) : null;
                let imgHtml = '';
                
                if (imgBase64) {
                    imgHtml = `<div style="margin: 15px 0; text-align: center; background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0;">
                               <img src="data:image/jpeg;base64,${imgBase64}" style="width: 60%; max-width: 400px; height: auto; border-radius: 6px; box-shadow: 0 3px 6px rgba(0,0,0,0.1);">
                           </div>`;
                }
                
                const borderTop = idx === 0 ? '' : 'border-top: 2px dashed #cbd5e1; margin-top: 2.5rem; padding-top: 1.5rem;';
                return `<div style="${borderTop}"><strong style="font-size: 1.3rem; color: #ef4444; background: #fee2e2; padding: 4px 12px; border-radius: 20px;">${match}</strong></div>${imgHtml}`;
            });

            resultText.innerHTML = `<div style="background: white; padding: 1.5rem; border-radius: 12px; border: 1px solid var(--border); line-height: 1.8;">${rawText}</div>`;

            // 🌟 [자동 저장 - 다중 요약 분석] 루프 파싱 연동 트리거 실행
            const blocks = analysisText.split(/\[문항\s*\d+\]/).map(b => b.trim()).filter(b => b.length > 10);
            for(let i = 0; i < blocks.length; i++) {
                let block = blocks[i];
                let qTxtM = block.match(/(?:0\.\s*문제 텍스트\s*:?)([\s\S]*?)(?=1\.\s*문항|$)/);
                let stdM = block.match(/(?:3\.\s*관련 성취기준\s*:?)([^\n]+)/);
                let lvM = block.match(/(?:4\.\s*성취수준\s*:?)\s*([A-E]\+?)/);
                let rsM = block.match(/(?:판정 이유\s*:?)([\s\S]*?)(?=$)/);

                let subQ = qTxtM ? qTxtM[1].trim() : "요약 분석 문제 텍스트";
                let subStd = stdM ? stdM[1].trim() : "미분류";
                let subLv = lvM ? lvM[1].trim() : "C";
                let subRs = rsM ? rsM[1].trim() : "요약 판정 근거 데이터";
                let subImg = cropBoxes[i] ? getCroppedBase64(cropBoxes[i]) : null;

                // 💡 [핵심 복구] 마지막 파라미터로 commonPassages(지문 이미지 배열)를 함께 전달합니다.
                await saveAnalysisAutomatically(subQ, subStd, subLv, subRs, subImg, commonPassages);
            }
        }

        // 💡 2. [추가된 부분] HTML이 DOM에 삽입된 직후 Mermaid를 초기화하여 그립니다.
        if (window.mermaid) {
            try {
                mermaid.init(undefined, document.querySelectorAll('.mermaid'));
            } catch (err) {
                console.error("Mermaid 렌더링 오류:", err);
            }
        }

        const saveZone = document.getElementById('save-analysis-zone');
        if (saveZone) saveZone.style.display = 'block';

        // 3. 마지막으로 수식(MathJax) 렌더링
        if (window.MathJax) {
            MathJax.typesetClear();
            MathJax.typesetPromise([resultDiv]);
        }

    } catch (error) {
        console.error('API Error:', error);
        let finalMsg = error.message;
        
        if (error.name === 'TypeError' && finalMsg.includes('Failed to fetch')) {
            finalMsg = "인터넷 연결이 불안정하거나 방화벽에 의해 차단되었습니다. 네트워크를 확인해주세요.";
        }
        
        // 🌟 [유실 방지 핵심!] 선생님의 원본 '다시 분석하기' UI 렌더링 코드가 100% 보존되었습니다.
        resultText.innerHTML = `<div style="padding: 15px; background-color: #fee2e2; border-left: 4px solid #ef4444; border-radius: 4px;">
            <p style="color: #b91c1c; font-weight: bold; margin: 0 0 10px 0;">🚨 분석 실패</p>
            <p style="margin: 0 0 15px 0; color: #7f1d1d;">${finalMsg}</p>
            <button onclick="executeAnalysis()" style="background: #ef4444; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">🔄 영역 유지하고 다시 분석하기</button>
        </div>`;
    }
}

// =========================================================================
// 🌟[업그레이드] 자동 저장 시스템 엔진 (공통 지문 텍스트 & 다중 이미지 완벽 지원)
// =========================================================================
async function saveAnalysisAutomatically(extractedText, rawCodesStr, levelStr, reasonStr, mainImageBase64, passageImagesArray = [], passageText = "") {
    try {
        const currentUserEmail = auth.currentUser ? auth.currentUser.email : "알 수 없음";
        const currentUserNickname = auth.currentUser ? (auth.currentUser.displayName || "선생님") : "알 수 없음";
        
        // 💡 [핵심 보완 1] 지문 텍스트가 따로 들어오면 문제 텍스트와 완벽하게 하나로 합칩니다.
        const fullTextToSave = passageText ? `[공통지문]\n${passageText}\n\n[문항]\n${extractedText}` : extractedText;

        // 💡 [핵심 보완 2] 메인 문제 이미지 1개 + 공통 지문 이미지 N개를 모두 project_images 서랍에 개별 저장하고 열쇠(ID)들을 모읍니다.
        let allImageIds = [];
        let imagesToUpload = [];
        
        if (mainImageBase64) imagesToUpload.push(mainImageBase64);
        if (passageImagesArray && passageImagesArray.length > 0) {
            imagesToUpload = imagesToUpload.concat(passageImagesArray);
        }

        for (const imgBase64 of imagesToUpload) {
            try {
                const imgDocRef = await db.collection('project_images').add({
                    source: "auto_ai_mirroring",
                    base64Data: imgBase64.startsWith('data:image') ? imgBase64 : `data:image/jpeg;base64,${imgBase64}`,
                    ownerEmail: currentUserEmail,
                    userNickname: currentUserNickname,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
                allImageIds.push(imgDocRef.id);
            } catch (err) { console.warn("🚨 [이미지 서랍] 저장 실패:", err); }
        }

        // 2단계: project_texts 서랍에 '새로운 개별 문서'로 적재 (프로젝트 유무 상관없음)
        try {
            await db.collection('project_texts').add({
                source: "auto_ai_mirroring",
                projectId: (typeof currentProjectId !== 'undefined' && currentProjectId) ? currentProjectId : "unassigned",
                ownerEmail: currentUserEmail,
                userNickname: currentUserNickname,
                questionText: fullTextToSave, // 지문이 포함된 완성형 텍스트
                reasonText: reasonStr,
                level: levelStr,
                standardCodes: rawCodesStr,
                imageIds: allImageIds, // 배열 형태로 여러 개의 이미지 열쇠 보관
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (err) { console.warn("🚨 [텍스트 서랍] 자동 미러링 실패:", err); }

        // 3단계: 융합 성취기준 코드를 찢어서 각각 개별 문서로 은행(transformed_bank)에 저장
        const cleanCodes = rawCodesStr.replace(/[\[\]\s]/g, '').split(',').filter(c => c.length > 0);
        const finalCleanLevel = levelStr.replace('+', '').trim();

        for (const singleCode of cleanCodes) {
            let matchedSubject = typeof detectSubjectIdFromStandardCode === 'function' ? detectSubjectIdFromStandardCode(singleCode) : 'uncategorized';
            if (matchedSubject === 'uncategorized' && typeof subjectData !== 'undefined') {
                for (const key in subjectData) {
                    if (subjectData[key].standards) {
                        const isMatched = subjectData[key].standards.some(s => 
                            s.code.replace(/[\[\]\s]/g, '') === singleCode
                        );
                        if (isMatched) { matchedSubject = key; break; }
                    }
                }
            }
            if (!matchedSubject) matchedSubject = 'uncategorized';

            // 문항 은행에 공통 지문이 포함된 문제로 예쁘게 안착
            await db.collection('transformed_bank').add({
                answer: "상세 풀이 및 분석 리포트 내용 참조",
                level: finalCleanLevel || "C",
                question: fullTextToSave, // 지문 + 문제 텍스트
                reason: reasonStr,
                standard_code: singleCode,
                subject: matchedSubject,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                user_email: currentUserEmail,
                user_nickname: currentUserNickname
            });
        }
        console.log(`✨ [자동 동시 저장 완료] 성취기준 대상: ${cleanCodes.join(', ')}`);
    } catch (e) {
        console.warn("🚨 백그라운드 자동 미러링 트랜잭션 실패:", e);
    }
}

function renderSophisticatedResult(rawText, base64Image) {
    const container = document.getElementById('result-text');
    container.innerHTML = "";

    if (base64Image) {
        const imgDiv = document.createElement('div');
        imgDiv.style.textAlign = 'center';
        imgDiv.style.marginBottom = '1.5rem';
        imgDiv.innerHTML = `<img src="data:image/jpeg;base64,${base64Image}" style="max-height: 200px; max-width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">`;
        container.appendChild(imgDiv);
    }

    let text = rawText.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    text = text.replace(/(\*\*|#)/g, ''); 
    text = text.replace(/(?:\[)?\s*원본\s*문제\s*추출\s*(?:\])?\s*:?/g, '[원본 문제 추출]:'); 
    text = text.replace(/(?:\[)?\s*교과\s*및\s*단원\s*(?:\])?\s*:?/g, '[교과 및 단원]:');
    text = text.replace(/(?:\[)?\s*성취기준\s*및\s*수준\s*(?:\])?\s*:?/g, '[성취기준 및 수준]:');
    text = text.replace(/(?:\[)?\s*핵심\s*개념\s*(?:\])?\s*:?/g, '[핵심 개념]:');
    text = text.replace(/(?:\[)?\s*시각화\s*자료\s*(?:\])?\s*:?/g, '[시각화 자료]:'); // 💡 새로 추가
    text = text.replace(/(?:\[)?\s*상세\s*풀이\s*(?:\])?\s*:?/g, '[상세 풀이]:');
    text = text.replace(/(?:\[)?\s*문제\s*풀이\s*(?:\])?\s*:?/g, '[상세 풀이]:'); 
    
const configs = [
        { key: "[원본 문제 추출]:", title: "추출된 원본 문제 텍스트", icon: "📝", bg: "#f8fafc", border: "#94a3b8" },
        { key: "[교과 및 단원]:", title: "교과명 및 단원명", icon: "📚", bg: "#f3f4f6", border: "#64748b" },
        { key: "[성취기준 및 수준]:", title: "성취기준과 성취수준", icon: "📍", bg: "#eff6ff", border: "#3b82f6" },
        { key: "[핵심 개념]:", title: "엄밀한 핵심 개념", icon: "💡", bg: "#fffbeb", border: "#f59e0b" },
        { key: "[시각화 자료]:", title: "문제 분석 시각 자료", icon: "📊", bg: "#fdf4ff", border: "#e11d48" },
        { key: "[상세 풀이]:", title: "단계별 정밀 풀이", icon: "✍️", bg: "#f0fdf4", border: "#10b981" }
    ];

configs.forEach((conf, index) => {
        let content = "";
        const startIndex = text.indexOf(conf.key);
        
        if (startIndex !== -1) {
            const contentStart = startIndex + conf.key.length;
            let nextKeyIndex = text.length; 
            configs.forEach((otherConf, otherIndex) => {
                if (index !== otherIndex) {
                    const idx = text.indexOf(otherConf.key, contentStart);
                    if (idx !== -1 && idx < nextKeyIndex) { nextKeyIndex = idx; }
                }
            });
            content = text.substring(contentStart, nextKeyIndex).trim();
        }

        if (!content) return;

        // 💡 [핵심] 정규식 개선: \n이 없거나 공백이 달라도 매칭되도록 수정
        if (conf.key === "[시각화 자료]:" || conf.key === "[상세 풀이]:") {
            content = content.replace(/(?:```svg\s*)?(?:&lt;svg|&lt;SVG)([\s\S]*?)(?:&lt;\/svg&gt;|&lt;\/SVG&gt;)(?:\s*```)?/g, function(match, p1) {
                let svgCode = `<svg${p1}</svg>`.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
                return `<div style="text-align: center; margin: 1.5rem 0; overflow-x: auto; background: white; padding: 1rem; border-radius: 8px; border: 1px dashed #e11d48;">${svgCode}</div>`;
            });
            
            content = content.replace(/```mermaid\s*([\s\S]*?)```/g, function(match, p1) {
                let mermaidCode = p1.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
                return `<div class="mermaid" style="text-align: center; margin: 1.5rem 0; background: white; padding: 1rem; border-radius: 8px; border: 1px dashed #e11d48;">${mermaidCode}</div>`;
            });
        }

        if (conf.key === "[원본 문제 추출]:") {
            content = content.replace(/\n/g, '<br>');
        }
        if (conf.key === "[성취기준 및 수준]:") {
            content = content.replace(/\n/g, ' ')
                             .replace(/(성취기준:)/g, '<strong style="color:#2563eb; font-size: 1.05rem;">$1</strong>')
                             .replace(/(성취수준:)/g, '<br><strong style="color:#2563eb; font-size: 1.05rem; margin-top: 8px; display: inline-block;">$1</strong>')
                             .replace(/(판정 이유:)/g, '<br><strong style="color:#2563eb; font-size: 1.05rem; margin-top: 8px; display: inline-block;">$1</strong>');
        }
        if (conf.key === "[상세 풀이]:") {
            content = content.replace(/(\d+단계[:.])/g, '<br><br><span style="background-color:#dbeafe; color:#1e40af; padding:4px 10px; border-radius:20px; font-weight:bold; font-size:0.95rem; display:inline-block; margin-bottom:8px;">$1</span><br>');
            if(content.startsWith('<br><br>')) content = content.substring(8);
            if(content.startsWith('<br>')) content = content.substring(4);
        }
        if (conf.key === "[핵심 개념]:") { content = content.replace(/\n/g, '<br>'); }

const card = document.createElement('div');
        card.style.cssText = `background: ${conf.bg}; border: 1px solid ${conf.border}44; border-left: 6px solid ${conf.border}; padding: 1.2rem; border-radius: 12px; margin-bottom: 1.2rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);`;
        
        card.innerHTML = `
            <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.8rem;">
                <span style="font-size:1.2rem;">${conf.icon}</span>
                <strong style="font-size:1.1rem; color:#1e293b;">${index}. ${conf.title}</strong>
            </div>
            <div class="analysis-content" style="color:#334155; line-height:1.8; font-size:0.95rem;">${content}</div>
        `;
        container.appendChild(card);
    });
}

// 💡 매개변수에 isRetry(재시도 여부)가 추가되었습니다.
async function processAndSaveBackground(analysisText, apiKey, isRetry = false) {
    try {
        const workerUrl = "https://script.google.com/macros/s/AKfycbwgx4RgF8FQxxL3jBgEQ5l369llADjhZ1NepulIdF4DdX18kBrB8oRQ4Ft0d5WdKtEF/exec"; 
        const userApiKey = localStorage.getItem('gemini_api_key');
        const response = await fetch(workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: "save_variant",
                analysisText: analysisText,
                apiKey: userApiKey
            })
        });

        const result = await response.json();
        
        if (result.error || !result.candidates || result.candidates.length === 0) {
            throw new Error(result.error ? JSON.stringify(result.error) : "응답 없음");
        }

        const aiResponse = result.candidates[0].content.parts[0].text;

        let finalQuestion = aiResponse;
        let finalAnswer = "정답 정보 없음";
        
        const qMatch = aiResponse.match(/문제:\s*([\s\S]*?)(?=그림:|정답:|$)/);
        const imgMatch = aiResponse.match(/그림:\s*([\s\S]*?)(?=정답:|$)/);
        const aMatch = aiResponse.match(/정답:\s*([\s\S]*?)(?=판정이유:|$)/); 
        
        if (qMatch) finalQuestion = qMatch[1].trim();
        if (aMatch) finalAnswer = aMatch[1].trim();

        let svgCode = imgMatch ? imgMatch[1].trim() : "";
        if (svgCode && svgCode !== "없음") {
            finalQuestion += `\n\n${svgCode}`; 
        }

        const reasonMatch = analysisText.match(/판정 이유:\s*([\s\S]*?)(?=\n\[|$)/);
        let extractedReason = reasonMatch ? reasonMatch[1].trim() : "AI가 교육과정 루브릭을 바탕으로 분석한 문항입니다.";

        // =========================================================================
        // 🕵️‍♂️ [분리 저장 로직 시작] 이미지 -> project_images / 텍스트 -> project_texts
        // =========================================================================
        const currentUserEmail = auth.currentUser ? auth.currentUser.email : "알 수 없음";
        const currentUserNickname = auth.currentUser ? (auth.currentUser.displayName || "선생님") : "알 수 없음";

        // 1. 이미지는 용량이 크므로 project_images에 개별 문서로 분리 저장 (이 방식이 맞습니다)
        let base64ImageToSave = null;
        const previewImgEl = document.getElementById('image-preview');
        if (previewImgEl && previewImgEl.src && previewImgEl.src.startsWith('data:image')) {
            base64ImageToSave = previewImgEl.src;
        }

        let finalImageId = null;
        if (base64ImageToSave) {
            try {
                const imgDocRef = await db.collection('project_images').add({
                    source: "admin_monitoring",
                    base64Data: base64ImageToSave,
                    ownerEmail: currentUserEmail,
                    userNickname: currentUserNickname,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
                finalImageId = imgDocRef.id;
            } catch (err) { console.warn("이미지 분리 저장 실패:", err); }
        }

        // 💡 2. 텍스트 분리 저장: 문항별 문서 생성 금지! currentProjectId 문서 하나에 병합(merge)
        try {
            if (typeof currentProjectId !== 'undefined' && currentProjectId) {
                // 해당 분석의 고유 식별자 생성
                const uniqueKey = `monitoring_${Date.now()}`; 
                
                const textUpdateData = {
                    ownerEmail: currentUserEmail,
                    userNickname: currentUserNickname,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                // 'texts' 객체 안에 필드를 추가하여, 문서 하나에 모든 문항 텍스트가 누적되도록 함
                textUpdateData[`texts.${uniqueKey}_question`] = finalQuestion;
                textUpdateData[`texts.${uniqueKey}_answer`] = finalAnswer;
                textUpdateData[`texts.${uniqueKey}_reason`] = extractedReason;
                if (finalImageId) {
                    textUpdateData[`texts.${uniqueKey}_imageId`] = finalImageId;
                }

                // merge: true 를 써야 기존 문항들의 텍스트가 삭제되지 않고 덧붙여집니다.
                await db.collection('project_texts').doc(currentProjectId).set(textUpdateData, { merge: true });
            }
        } catch (err) { console.warn("텍스트 병합 저장 실패:", err); }
        // =========================================================================

        const stdCodes = analysisText.match(/\[\d{2}[^\]]+-\d{2}-\d{2}\]/g) || ["unknown"];
        const levelMatch = analysisText.match(/(?:성취수준|수준)[\s:은는]*([A-E]\+?)/) || analysisText.match(/\[수준\]\s*([A-E]\+?)/);
        let extractedLevel = levelMatch ? levelMatch[1].replace('+', '') : "C";

        // 3. 변형 문항은 별도의 은행(transformed_bank)에 저장
        for (const code of stdCodes) {
            let cleanCode = code.replace(/[\[\]\s]/g, '');
            let matchedSubject = typeof detectSubjectIdFromStandardCode === 'function' ? detectSubjectIdFromStandardCode(cleanCode) : 'uncategorized';
            
            // ... (기존 과목 매칭 로직 유지) ...
            if (matchedSubject === 'uncategorized') {
                for (const key in subjectData) {
                    if (subjectData[key].standards) {
                        const isMatched = subjectData[key].standards.some(s => 
                            s.code.replace(/[\[\]\s]/g, '') === cleanCode
                        );
                        if (isMatched) { matchedSubject = key; break; }
                    }
                }
            }
            if (!matchedSubject) matchedSubject = 'uncategorized';

            await db.collection('transformed_bank').add({
                answer: finalAnswer,
                level: extractedLevel,
                question: finalQuestion, // 문항 은행에는 텍스트가 들어가는 것이 맞습니다.
                reason: extractedReason,
                standard_code: code.replace(/[\[\]]/g, '').trim(),
                subject: matchedSubject,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                user_email: currentUserEmail,
                user_nickname: currentUserNickname 
            });
        }

        console.log("✅ 문항 분석 결과 및 변형 문항이 성공적으로 분리 저장되었습니다.");

    } catch (e) { 
        console.warn("데이터 저장 또는 통신 실패:", e);
        if (!isRetry) {
            let pending = JSON.parse(localStorage.getItem('pending_variants')) || [];
            pending.push({ analysisText: analysisText, time: new Date().toISOString() });
            localStorage.setItem('pending_variants', JSON.stringify(pending));
            console.log("통신 지연으로 인해 로컬에 임시 보관했습니다.");
        } else {
            throw e;
        }
    }
}

function showSection(id) {
    // 1. 🟢 [핵심] 방금 마우스로 클릭한 '정확한 버튼' 추적하기
    let clickedBtn = null;
    if (typeof event !== 'undefined' && event.currentTarget) {
        clickedBtn = event.currentTarget;
    } else if (window.event && window.event.currentTarget) {
        clickedBtn = window.event.currentTarget;
    }

    const currentActive = document.querySelector('.section.active');
    
    // 2. 🟢 [핵심 해결] '분할점수 산출(cut-score)' 탭은 방어막을 무시하고 무조건 초기화되도록 하이패스!
    if (currentActive && currentActive.id === id) {
        if (id !== 'cut-score') { // 👈 분할점수 탭이 아닐 때만 방어막 작동
            if (clickedBtn && clickedBtn.classList.contains('active')) {
                return; 
            }
            if (!clickedBtn) return; 
        }
    }

    // 3. 작업 중 이탈 방지 경고창
    if (currentActive && currentActive.id.includes('analysis')) {
        const hasPassages = typeof commonPassages !== 'undefined' && commonPassages.length > 0;
        const previewContainer = document.getElementById('preview-container');
        const hasImage = previewContainer && previewContainer.style.display !== 'none';
        const textInput = document.getElementById('question-text');
        const hasText = textInput && textInput.value.trim() !== '';

        if (hasPassages || hasImage || hasText) {
            if (!confirm('현재 작업 중인 내용(지문, 이미지 또는 텍스트)이 있습니다. 다른 메뉴로 이동하면 작업 내역이 모두 초기화됩니다. 계속하시겠습니까?')) {
                return; // 취소하면 이동 중단
            }
        }
    }

    // 4. 🟢 [요약/상세 지문 완벽 분리] 탭을 이동할 때 '무조건' 지문 보관함 싹 비우기
    if (typeof commonPassages !== 'undefined') {
        commonPassages = [];
        const thumbnailContainer = document.getElementById('passage-thumbnails');
        if (thumbnailContainer) thumbnailContainer.innerHTML = '';
        const tray = document.getElementById('common-passage-tray');
        if (tray) tray.style.display = 'none'; // 지문 화면 닫기
    }
    const textInputs = ['question-text', 'chat-input']; 
    textInputs.forEach(inputId => {
        const el = document.getElementById(inputId);
        if (el) el.value = '';
    });
    document.querySelectorAll('.result-content, .analysis-result').forEach(el => el.innerHTML = '');
    
    // resetAnalysis가 있으면 실행해서 이전 화면 잔여물 제거
    if (typeof resetAnalysis === 'function') resetAnalysis(false); 

    // 💡 [최적화 방어막 2] 분할점수(협업) 화면을 떠나 다른 탭으로 갈 때 모든 실시간 CCTV 끄기
    if (id !== 'cut-score') {
        if (projectDetailsUnsubscribe) { projectDetailsUnsubscribe(); projectDetailsUnsubscribe = null; }
        if (unsubscribeProject) { unsubscribeProject(); unsubscribeProject = null; }
        if (unsubscribeMemos) { unsubscribeMemos(); unsubscribeMemos = null; }
    }

    // 5. 화면(섹션) 전환
    document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
    const targetSection = document.getElementById(id);
    if (targetSection) targetSection.classList.add('active');

    // 6. 🟢 [파란불 완벽 제어] 클릭한 바로 그 버튼 하나만 파란색으로 만들기!
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    
    if (clickedBtn && clickedBtn.classList.contains('tab-btn')) {
        clickedBtn.classList.add('active'); // 사용자가 방금 클릭한 버튼만 켬!
    } else {
        // 새로고침 등 클릭 없이 넘어왔을 때의 예비 동작
        const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => {
            const oc = b.getAttribute('onclick') || '';
            return oc.includes(`'${id}'`) || oc.includes(`"${id}"`);
        });
        if (activeBtn) activeBtn.classList.add('active');
    }
    
    // 7. 기타 UI 제목 표시/숨기기
    const curriculumSelector = document.querySelector('.curriculum-selector');
    const subTitle = document.getElementById('main-subtitle'); 

    if (id.includes('analysis') || id === 'cut-score') {
        if (curriculumSelector) curriculumSelector.style.visibility = 'hidden';
        if (subTitle) subTitle.style.visibility = 'hidden';
    } else {
        if (curriculumSelector) curriculumSelector.style.visibility = 'visible';
        if (subTitle) subTitle.style.visibility = 'visible';
    }
    
    history.pushState({ section: id }, "", "#" + id);

    // 8. 탭 진입 시 고유 데이터 로드
    if (id === 'cut-score') {
        currentProjectId = null;
        document.querySelectorAll('.cut-score-card').forEach(card => card.style.display = 'none');
        document.getElementById('cut-score-dashboard').style.display = 'block';
        
        // 💡 [기능 유실 방지 및 추가] 메뉴 클릭 시 겹쳐 있던 하위 상세 화면들을 깔끔하게 청소합니다.
        const detailView = document.getElementById('project-detail-view');
        const step2 = document.getElementById('cut-score-step2');
        const step4 = document.getElementById('cut-score-step4');
        if (detailView) detailView.style.display = 'none';
        if (step2) step2.style.display = 'none';
        if (step4) step4.style.display = 'none';

        if (typeof loadProjects === 'function') loadProjects();
    } else if (id === 'quiz') {
        const qSelect = document.getElementById('quiz-standard-selection');
        const qMatch = document.getElementById('quiz-level-matching');
        if(qSelect) qSelect.style.display = 'block';
        if(qMatch) qMatch.style.display = 'none';
    } else if (id === 'bookmark') {
        const bList = document.getElementById('bookmark-list');
        if(bList) bList.innerHTML = ""; 
        ['A', 'B', 'C', 'D', 'E'].forEach(l => {
            const btn = document.getElementById(`bm-btn-${l}`);
            if (btn) {
                btn.style.opacity = '1';
                btn.style.transform = 'scale(1)';
                btn.style.border = '3px solid transparent';
                btn.style.boxShadow = 'none';
            }
        });
    } else if (id === 'checklist') { 
        if (typeof initChecklist === 'function') initChecklist(); 
    }
}

// ==========================================
// 📚 2022 개정 교육과정 전체 교과/과목 매핑 데이터
// ==========================================
let currentGroup = 'math'; 
let currentSubjectQCount = {}; // 💡 과목별 문항 개수 미리 저장소
let cachedSubjectQCounts = {}; // 🌟 [방어막 추가] 한 번 센 문항 개수를 기억해두는 캐시 수첩!

const curriculumMap = {
    'math': {
        '공통 과목': [{id: 'common1', name: '공통수학1'}, {id: 'common2', name: '공통수학2'}, {id: 'basic_math1', name: '기본수학1'}, {id: 'basic_math2', name: '기본수학2'}],
        '일반 선택': [{id: 'algebra', name: '대수'}, {id: 'calculus1', name: '미적분Ⅰ'}, {id: 'probStat', name: '확률과 통계'}],
        '진로 선택': [{id: 'geometry', name: '기하'}, {id: 'calculus2', name: '미적분Ⅱ'}, {id: 'econ_math', name: '경제 수학'}, {id: 'ai-math', name: '인공지능 수학'}, {id: 'job_math', name: '직무 수학'}],
        '융합 선택': [{id: 'math_culture', name: '수학과 문화'}, {id: 'prac_stats', name: '실용 통계'}, {id: 'math_task', name: '수학과제 탐구'}],
        '기타': [{id: 'uncategorized', name: '📦 미분류 보관함'}]
    },
    'korean': {
        '공통 과목': [{id: 'kor_common1', name: '공통국어1'}, {id: 'kor_common2', name: '공통국어2'}],
        '일반 선택': [{id: 'kor_speech', name: '화법과 언어'}, {id: 'kor_read_write', name: '독서와 작문'}, {id: 'kor_lit', name: '문학'}],
        '진로 선택': [{id: 'kor_theme', name: '주제 탐구 독서'}, {id: 'kor_lit_media', name: '문학과 영상'}, {id: 'kor_job', name: '직무 의사소통'}],
        '융합 선택': [{id: 'kor_debate', name: '독서 토론과 글쓰기'}, {id: 'kor_media', name: '매체 의사소통'}, {id: 'kor_life', name: '언어생활 탐구'}]
    },
    'english': {
        '공통 과목': [{id: 'eng_common1', name: '공통영어1'}, {id: 'eng_common2', name: '공통영어2'}, {id: 'eng_basic1', name: '기본영어1'}, {id: 'eng_basic2', name: '기본영어2'}],
        '일반 선택': [{id: 'eng_1', name: '영어Ⅰ'}, {id: 'eng_2', name: '영어Ⅱ'}, {id: 'eng_read_write', name: '영어 독해와 작문'}],
        '진로 선택': [{id: 'eng_lit', name: '영미 문학 읽기'}, {id: 'eng_pres', name: '영어 발표와 토론'}, {id: 'eng_adv', name: '심화 영어'}, {id: 'eng_adv_rw', name: '심화 영어 독해와 작문'}, {id: 'eng_job', name: '직무 영어'}],
        '융합 선택': [{id: 'eng_life', name: '실생활 영어 회화'}, {id: 'eng_media', name: '미디어 영어'}, {id: 'eng_world', name: '세계 문화와 영어'}]
    },
    'social': {
        '공통 과목': [{id: 'history1', name: '한국사1'}, {id: 'history2', name: '한국사2'}, {id: 'soc_common1', name: '통합사회1'}, {id: 'soc_common2', name: '통합사회2'}],
        '일반 선택': [{id: 'soc_citizen', name: '세계시민과 지리'}, {id: 'soc_world', name: '세계사'}, {id: 'soc_culture', name: '사회와 문화'}, {id: 'soc_ethics', name: '현대사회와 윤리'}],
        '진로 선택': [{id: 'soc_geo_kor', name: '한국지리 탐구'}, {id: 'soc_city', name: '도시의 미래 탐구'}, {id: 'soc_asia', name: '동아시아 역사 기행'}, {id: 'soc_pol', name: '정치'}, {id: 'soc_law', name: '법과 사회'}, {id: 'soc_econ', name: '경제'}, {id: 'soc_think', name: '윤리와 사상'}, {id: 'soc_human', name: '인문학과 윤리'}, {id: 'soc_inter', name: '국제 관계의 이해'}],
        '융합 선택': [{id: 'soc_travel', name: '여행지리'}, {id: 'soc_modern', name: '역사로 탐구하는 현대 세계'}, {id: 'soc_prob', name: '사회문제 탐구'}, {id: 'soc_finance', name: '금융과 경제생활'}, {id: 'soc_eth_prob', name: '윤리문제 탐구'}, {id: 'soc_climate', name: '기후변화와 지속가능한 세계'}]
    },
    'science': {
        '공통 과목': [{id: 'sci_common1', name: '통합과학1'}, {id: 'sci_common2', name: '통합과학2'}, {id: 'sci_exp1', name: '과학탐구실험1'}, {id: 'sci_exp2', name: '과학탐구실험2'}],
        '일반 선택': [{id: 'sci_phy', name: '물리학'}, {id: 'sci_chem', name: '화학'}, {id: 'sci_bio', name: '생명과학'}, {id: 'sci_earth', name: '지구과학'}],
        '진로 선택': [{id: 'sci_mech', name: '역학과 에너지'}, {id: 'sci_electro', name: '전자기와 양자'}, {id: 'sci_matter', name: '물질과 에너지'}, {id: 'sci_chem_re', name: '화학 반응의 세계'}, {id: 'sci_cell', name: '세포와 물질대사'}, {id: 'sci_gene', name: '생물의 유전'}, {id: 'sci_earth_sys', name: '지구시스템과학'}, {id: 'sci_space', name: '행성우주과학'}],
        '융합 선택': [{id: 'sci_history', name: '과학의 역사와 문화'}, {id: 'sci_climate', name: '기후변화와 환경생태'}, {id: 'sci_converge', name: '융합과학 탐구'}]
    }
};

// 교과군(탭) 변경 시 호출 (준비중 과목 비활성화 및 자동 선택 적용)
function changeGroup(groupId) {
    currentGroup = groupId;
    
    // 버튼 스타일 활성화 변경
    document.querySelectorAll('.group-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`button[onclick="changeGroup('${groupId}')"]`).classList.add('active');
    
    // 해당 교과군에 맞춰 드롭다운 다시 그리기
    const selectEl = document.getElementById('detail-subjects');
    selectEl.innerHTML = '';
    const map = curriculumMap[groupId];
    
    let firstEnabledSubject = null; // 💡 탭을 열었을 때 데이터가 있는 첫 번째 과목을 찾기 위한 변수
    
    for (const category in map) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = category;
        map[category].forEach(sub => {
            const opt = document.createElement('option');
            opt.value = sub.id;
            
            // ✨ 핵심: 해당 과목 데이터가 subjectData에 있는지 확인!
            if (typeof subjectData !== 'undefined' && subjectData[sub.id] && subjectData[sub.id].standards && subjectData[sub.id].standards.length > 0) {
                // 성취기준 데이터가 1개라도 있으면 정상적으로 출력
                opt.innerText = sub.name;
                if (!firstEnabledSubject) firstEnabledSubject = sub.id; // 첫 활성화 과목 기억
            } else {
                // 성취기준 데이터가 0개면 (준비중)으로 비활성화 처리
                opt.innerText = sub.name + " (준비중)";
                opt.disabled = true;           // 마우스로 선택 불가
                opt.style.color = "#94a3b8";   // 글자색을 흐린 회색으로 변경
            }
            
            optgroup.appendChild(opt);
        });
        selectEl.appendChild(optgroup);
    }
    
    // 💡 무조건 첫 번째 항목이 아니라, "데이터가 존재하는 첫 번째 과목"으로 드롭다운을 맞춤
    if (firstEnabledSubject) {
        selectEl.value = firstEnabledSubject;
    }
    
    // 과목을 변경했으니 화면 전체 새로고침
    changeSubject();
}

async function changeSubject() {
    currentSubject = document.getElementById('detail-subjects').value;
    
    // 1. 부제목(단원명 등) 업데이트
    const data = subjectData[currentSubject];
    const subTitleEl = document.getElementById('main-subtitle');
    if (data) { 
        subTitleEl.innerText = "[" + data.title + "] " + (data.subtitle || "과목 정보가 등록되어 있습니다."); 
    } else {
        subTitleEl.innerText = "이 과목의 성취기준 데이터가 아직 등록되지 않았습니다.";
    }
    
    // 2. 버튼 비활성화를 위한 문항 개수 계산 (🌟 수첩 캐시 적용!)
    if (currentSubject && currentSubject !== 'uncategorized') {
        if (cachedSubjectQCounts[currentSubject]) {
            currentSubjectQCount = cachedSubjectQCounts[currentSubject];
        } else {
            currentSubjectQCount = {};
            try {
                const snapshot = await db.collection('transformed_bank').where('subject', '==', currentSubject).get();
                snapshot.forEach(doc => {
                    const stdCodes = doc.data().standard_code;
                    if (Array.isArray(stdCodes)) {
                        stdCodes.forEach(code => {
                            if (code && code !== "unknown" && code !== "코드없음") {
                                const cleanCode = code.replace(/[\[\]\s]/g, '');
                                currentSubjectQCount[cleanCode] = (currentSubjectQCount[cleanCode] || 0) + 1;
                            }
                        });
                    } 
                    else if (typeof stdCodes === 'string') {
                        if (stdCodes && stdCodes !== "unknown" && stdCodes !== "코드없음") {
                            const cleanCode = stdCodes.replace(/[\[\]\s]/g, '');
                            currentSubjectQCount[cleanCode] = (currentSubjectQCount[cleanCode] || 0) + 1;
                        }
                    }
                });
                cachedSubjectQCounts[currentSubject] = currentSubjectQCount;
            } catch(e) { console.warn("문항 수 계산 실패", e); }
        }
    } else {
        currentSubjectQCount = {};
    }

    // 🌟 3. [핵심] 3가지 화면 모두 즉시 새로고침
    initDashboard(); 
    if (typeof initChecklist === 'function') initChecklist(); 

    // ✨👇 [여기에 딱 3줄만 추가했습니다!] 과목이 바뀌면 수행평가 드롭다운도 즉시 갱신 👇✨
    if (typeof populatePerformanceStandards === 'function') {
        populatePerformanceStandards();
    }

    // 🚫 [핵심 수정 1] 여기서 loadBookmark()를 호출하던 것을 삭제했습니다. (유지됨)

    // 👇 [여기에 3줄 추가] 과목을 바꾸면 무조건 초기 화면으로 강제 이동 및 퀴즈 상자 닫기 (유지됨)
    if (document.getElementById('quiz-standard-selection')) document.getElementById('quiz-standard-selection').style.display = 'block';
    if (document.getElementById('quiz-level-matching')) document.getElementById('quiz-level-matching').style.display = 'none';
}

function initDashboard() {
    const container = document.getElementById('card-container');
    container.innerHTML = "";
    
    if (!subjectData[currentSubject] || subjectData[currentSubject].standards.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:3rem; background:white; border-radius:12px; color:#64748b; font-weight:bold;">관리자 메뉴에서 이 과목의 성취기준을 먼저 등록해 주세요! 👨‍🔧</div>`;
        return;
    }
    
    const standards = subjectData[currentSubject].standards;
    // 💡 과목의 성취기준 중 중단원(category) 정보가 단 하나라도 있는지 검사합니다.
    const hasCategory = standards.some(std => std.category && std.category.trim() !== "");

    if (hasCategory) {
        // [A안] 중단원이 존재하는 경우: 단원별 그룹화 처리
        const groupedStandards = {};
        standards.forEach(std => {
            const cat = std.category || '미분류 단원';
            if (!groupedStandards[cat]) groupedStandards[cat] = [];
            groupedStandards[cat].push(std);
        });

        for (const category in groupedStandards) {
            // 단원별 제목(헤더) 추가
            const catHeader = document.createElement('h3');
            catHeader.style.cssText = "margin-top: 2rem; margin-bottom: 1rem; color: #1e3a8a; border-bottom: 2px solid #cbd5e1; padding-bottom: 0.5rem;";
            catHeader.innerText = `📂 ${category}`;
            container.appendChild(catHeader);

            // 해당 단원에 속한 카드들 그리기
            groupedStandards[category].forEach(std => {
                renderStandardCard(std, container);
            });
        }
    } else {
        // [B안] 중단원이 아예 없는 경우: 이전처럼 순서대로 카드만 바로 그리기
        standards.forEach(std => {
            renderStandardCard(std, container);
        });
    }
    
    // 수식(MathJax) 깨짐 방지 후처리
    setTimeout(() => {
        if (window.MathJax && window.MathJax.typesetPromise) { 
            MathJax.typesetClear(); 
            MathJax.typesetPromise([container]).catch(err => console.error("수식 렌더링 에러:", err)); 
        }
    }, 300);
}

// 💡 중복 코드를 방지하고 가독성을 높이기 위해 카드를 그리는 로직을 별도 함수로 분리했습니다.
function renderStandardCard(std, container) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.display = 'block';
    card.style.position = 'relative';

    const textArea = document.createElement('div');
    textArea.style.cursor = 'pointer';
    textArea.style.wordBreak = 'keep-all'; 
    textArea.innerHTML = `<h3 style="margin: 0 0 0.5rem 0; color: var(--primary);">${std.code}</h3><p style="margin: 0; color: var(--text-main); line-height: 1.6;">${std.desc}</p>`;
    textArea.onclick = () => openModal(std);
    
    const btnArea = document.createElement('div');
    btnArea.style.textAlign = 'right';
    btnArea.style.marginTop = '15px'; 
    
    const cleanStdCode = std.code.replace(/[\[\]\s]/g, '');
    const qCount = currentSubjectQCount[cleanStdCode] || 0;
    const hasQuestions = (std.questions && std.questions.length > 0) || qCount > 0; 
    
    const quizBtn = document.createElement('button');
    
    if (hasQuestions) {
        quizBtn.className = 'save-btn'; 
        quizBtn.style.display = 'inline-flex';
        quizBtn.style.justifyContent = 'center';
        quizBtn.style.alignItems = 'center';
        quizBtn.style.width = '170px';
        quizBtn.style.height = '42px';
        quizBtn.style.margin = '0 0 0 auto';
        quizBtn.style.padding = '0'; 
        quizBtn.style.fontSize = '0.9rem';
        quizBtn.style.borderRadius = '8px'; 
        quizBtn.style.whiteSpace = 'nowrap';
        quizBtn.innerHTML = `📝 문항 매칭 연습 <span style="background:rgba(255,255,255,0.3); color:white; padding:2px 6px; border-radius:12px; font-size:0.75rem; margin-left:4px;">${qCount}개</span>`;
        quizBtn.onclick = (e) => {
            e.stopPropagation(); 
            showSection('quiz'); 
            startLevelMatching(std.code); 
        };
    } else {
        quizBtn.className = 'save-btn disabled-btn'; 
        quizBtn.style.display = 'inline-flex';
        quizBtn.style.justifyContent = 'center';
        quizBtn.style.alignItems = 'center';
        quizBtn.style.width = '160px';
        quizBtn.style.height = '42px';
        quizBtn.style.margin = '0 0 0 auto';
        quizBtn.style.padding = '0'; 
        quizBtn.style.fontSize = '0.9rem';
        quizBtn.style.borderRadius = '8px'; 
        quizBtn.style.whiteSpace = 'nowrap';
        quizBtn.innerHTML = '🚫 등록된 문항 없음';
        quizBtn.disabled = true;
        quizBtn.onclick = (e) => { e.stopPropagation(); };
    }
    
    btnArea.appendChild(quizBtn);
    card.appendChild(textArea);
    card.appendChild(btnArea);
    container.appendChild(card);
}

async function startLevelMatching(code) {
    currentStandardCode = code; currentLevelQ = 0;
    const standard = subjectData[currentSubject].standards.find(s => s.code === code);
    
    let combinedQuestions = standard.questions ? [...standard.questions] : []; 

    try {
        let cleanInputCode = code.replace(/[\[\]\s]/g, '');
        // 💡 배열 내 포함 여부를 검사하는 array-contains 활용
        const snapshot = await db.collection('transformed_bank')
         .where('standard_code', 'array-contains', cleanInputCode)
         .get();
         
        snapshot.forEach(doc => {
            const data = doc.data();
            let extractedLevel = data.level || data.original_analysis?.match(/성취수준:\s*([A-E])/)?.[1] || "C"; 
            
            let extractedReason = data.reason || data.original_analysis?.match(/판정 이유:\s*([\s\S]*?)(?=\n\[|$)/)?.[1]?.trim() || "사용자가 업로드한 문항을 AI가 분석하고 변형한 실전 문항입니다.";
        
            let sourceBadge = data.source === "선생님 직접 등록"
                ? `<div style="background-color: #e0e7ff; padding: 10px; border-left: 4px solid #3b82f6; margin-bottom: 10px; border-radius: 4px;">
                       <span style="font-size: 0.8rem; color: #1e40af; font-weight: bold;">🧑‍🏫 선생님 등록 문항</span>
                   </div>`
                : `<div style="background-color: #f0fdf4; padding: 10px; border-left: 4px solid #22c55e; margin-bottom: 10px; border-radius: 4px;">
                       <span style="font-size: 0.8rem; color: #166534; font-weight: bold;">💡 AI 변형 추가 문항</span>
                   </div>`;
        
            // 💡 [핵심 추가] 문제 텍스트에 포함된 마크다운 SVG 코드를 진짜 그림 태그로 변환하기
            let pureQuestion = data.question || data.q || "문제 내용이 없습니다.";

            let imgHtml = data.image ? `<br><img src="${data.image}" style="max-width:100%; margin-top:15px; border-radius:8px; border:1px solid #cbd5e1; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">` : "";
            let displayCode = Array.isArray(data.standard_code) ? data.standard_code.join(', ') : (data.standard_code || "unknown");
            
            combinedQuestions.push({
                id: doc.id,
                q: sourceBadge + pureQuestion, // 💡 변환된 pureQuestion을 넣어줍니다!
                level: extractedLevel,
                reason: extractedReason,
                answer: data.answer || "정답 정보 없음",
                standard_code: displayCode, // 💡 변환된 코드를 넣어줍니다!
                image: data.image || data.imageUrl || data.img 
            });
        });
    } catch (error) { console.warn("DB 로드 실패"); }

    currentQuestions = shuffleArray(combinedQuestions);
    document.getElementById('quiz-standard-selection').style.display = 'none';
    document.getElementById('quiz-level-matching').style.display = 'block';
    document.getElementById('selected-standard-info').innerText = `${standard.code} ${standard.desc}`;
    
    const levelsContainer = document.getElementById('achievement-levels-side');
    levelsContainer.innerHTML = `
        <h4>성취수준 가이드</h4>
        <div class="guide-item"><strong>A (상)</strong> ${standard.levels.high}</div>
        <div class="guide-item"><strong>B (우수)</strong> ${standard.levels.b || standard.levels.high.replace("이해하여 설명할 수 있으며", "설명할 수 있고").replace("체계적으로 수행", "정확하게 수행")}</div>
        <div class="guide-item"><strong>C (중)</strong> ${standard.levels.mid}</div>
        <div class="guide-item"><strong>D (미흡)</strong> ${standard.levels.d || standard.levels.mid.replace("이해하고", "알고").replace("계산을 할 수 있다", "간단한 계산을 할 수 있다")}</div>
        <div class="guide-item"><strong>E (하)</strong> ${standard.levels.low}</div>
    `;
    if (window.MathJax) MathJax.typesetPromise([levelsContainer]);

    if (currentQuestions.length === 0) {
        document.getElementById('level-question-text').innerHTML = "<p style='text-align:center; margin-top:2rem;'>아직 이 성취기준에 등록된 문항이 없습니다.<br>문제 분석하기 기능을 통해 문항을 추가해 보세요!</p>";
        document.getElementById('level-options').innerHTML = '';
        document.getElementById('level-feedback').style.display = 'none';
        document.getElementById('next-q-btn').style.display = 'none';
    } else {
        loadLevelQuestion();
    }
}

function loadLevelQuestion() {
    const qBox = document.getElementById('level-question-text');
    const optionsBox = document.getElementById('level-options');
    const feedbackBox = document.getElementById('level-feedback');
    const nextBtn = document.getElementById('next-q-btn');
    if (currentQuestions.length === 0) return;
    const question = currentQuestions[currentLevelQ];
    
    // 💡 [초강력 보안 대피소 로직] 그림 코드가 <br>에 의해 찢어지는 것을 완벽 차단!
    let pureText = question.q || "";
    let svgBlocks = [];
    
    // 1. 임시 도화지를 만들어 브라우저가 직접 SVG를 100% 안전하게 찾아내도록 합니다.
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = pureText;
    
    const svgs = tempDiv.querySelectorAll('svg');
    svgs.forEach((svg, index) => {
        svgBlocks.push(svg.outerHTML);
        const placeholder = document.createTextNode(`%%SVG_PLACEHOLDER_${index}%%`);
        svg.parentNode.replaceChild(placeholder, svg);
    });
    
    pureText = tempDiv.innerHTML; // SVG가 플레이스홀더로 바뀐 안전한 텍스트 획득

    // 2. 백틱(```svg ... ```)으로 감싸진 마크다운 형태도 혹시 모르니 추가로 잡아냅니다.
    pureText = pureText.replace(/```svg\s*([\s\S]*?)\s*```/gi, (match, innerSvg) => {
        svgBlocks.push(innerSvg.trim());
        return `%%SVG_PLACEHOLDER_${svgBlocks.length - 1}%%`;
    });
    
    // 3. 그림이 100% 안전하게 대피한 순수 텍스트 상태에서만 줄바꿈(<br>) 적용!
    let formattedText = pureText.replace(/\n/g, '<br>');
    formattedText = formattedText.replace(/(①|②|③|④|⑤)/g, '<br>&nbsp;&nbsp;$1');
    
    // 4. 줄바꿈이 끝났으니, 대피소에 있던 그림을 예쁜 박스에 담아 원래 위치에 복원
    svgBlocks.forEach((svgContent, idx) => {
        // 모바일에서도 넘치지 않게 반응형 스타일 강제 주입
        let safeSvg = svgContent
            .replace(/<svg/i, '<svg style="max-width: 400px; width: 100%; height: auto; display: block; margin: 0 auto;"')
            .replace(/width="100%"/i, '')    // 기존의 충돌하는 가로 속성 제거
            .replace(/height="100%"/i, '');  // 기존의 충돌하는 세로 속성 제거
        const svgBoxHtml = `
            <div class="svg-box" style="margin-top: 15px; text-align: center; background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0; overflow-x: auto;">
                ${safeSvg}
            </div>`;
        formattedText = formattedText.replace(`%%SVG_PLACEHOLDER_${idx}%%`, svgBoxHtml);
    });
    
    // 🌟 Base64 이미지 데이터가 있으면 img 태그 만들기 (기존 기능 100% 유지)
    let imageHtml = '';
    const questionImage = question.image || question.imageUrl || question.img; 
    
    if (questionImage) {
        imageHtml = `
            <div style="margin: 20px 0; text-align: center; background: #fffbeb; padding: 15px; border-radius: 8px; border: 1px dashed #f59e0b; box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);">
                <div style="color: #d97706; font-size: 0.9rem; font-weight: bold; margin-bottom: 12px; word-break: keep-all;">
                    ⚠️ [원본 참고용 그림] AI가 문제의 조건을 변형했습니다.<br>그림 속 숫자는 무시하고 형태만 참고하세요.
                </div>
                <img src="${questionImage}" alt="문항 첨부 이미지" style="max-width: 100%; height: auto; border-radius: 6px; box-shadow: 0 2px 6px rgba(0,0,0,0.1);">
            </div>
        `;
    }
    
    // 5. 화면에 출력
    qBox.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">
            <strong style="color: #1e3a8a; font-size: 1.1rem;">[문항 ${currentLevelQ + 1} / ${currentQuestions.length}]</strong>
            <div style="display: flex; gap: 8px;">
                <button onclick="prevLevelQuestion()" style="background: white; border: 1px solid #cbd5e1; color: #475569; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.85rem; box-shadow: 0 1px 2px rgba(0,0,0,0.05); transition: 0.2s;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='white'">◀ 이전</button>
                <button onclick="skipLevelQuestion()" style="background: white; border: 1px solid #cbd5e1; color: #475569; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.85rem; box-shadow: 0 1px 2px rgba(0,0,0,0.05); transition: 0.2s;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='white'">다음 ▶</button>
            </div>
        </div>
        <div style="font-size: 1rem; line-height: 1.8; color: #1e293b;">
            ${formattedText}
            ${imageHtml}
        </div>
    `;
    
    optionsBox.innerHTML = ''; feedbackBox.style.display = 'none'; nextBtn.style.display = 'none';
    
    ['A', 'B', 'C', 'D', 'E'].forEach(level => {
        const btn = document.createElement('button');
        btn.className = 'option-btn'; btn.innerText = level;
        btn.onclick = () => checkLevelAnswer(level, btn);
        optionsBox.appendChild(btn);
    });
    if (window.MathJax && window.MathJax.typesetPromise) { MathJax.typesetClear(); MathJax.typesetPromise([qBox]); }
}

function checkLevelAnswer(selectedLevel, btn) {
    const question = currentQuestions[currentLevelQ];
    const fb = document.getElementById('level-feedback');
    document.querySelectorAll('#level-options .option-btn').forEach(b => { b.disabled = true; b.style.opacity = '0.6'; });
    fb.style.display = 'block';
    
    const answerHTML = question.answer ? `<br><br><div style="background: white; padding: 10px; border-radius: 8px; border: 1px solid #cbd5e1;"><strong style="color: #475569;">[정답]</strong> ${question.answer}</div>` : '';

    // 💡 융합 문항인 경우(코드에 쉼표가 있을 때) 안내 메시지 추가
    let fusionNotice = '';
    if (question.standard_code && question.standard_code.includes(',')) {
        fusionNotice = `<div style="background: #eef2ff; color: #4338ca; padding: 8px; border-radius: 6px; font-size: 0.85rem; margin-bottom: 10px; border-left: 4px solid #6366f1;"><strong>🧩 융합 문항 안내:</strong> 이 문항은 복수의 성취기준(${question.standard_code})이 유기적으로 결합된 문항입니다.</div>`;
    }

    if (selectedLevel === question.level) {
        fb.innerHTML = `🎉 <strong>정답입니다!</strong><br><br>${fusionNotice}<strong>[이유]</strong> ${question.reason} ${answerHTML}`;
        fb.style.color = "#166534"; fb.style.backgroundColor = '#dcfce7';
        btn.style.border = '3px solid #166534'; btn.style.opacity = '1';
    } else {
        const wrongLevelExample = currentQuestions.find(q => q.level === selectedLevel);
        let comparativeText = "";
        
        if (wrongLevelExample) {
            // 💡 예시 문항도 본 문항과 똑같이 줄바꿈과 선지 정렬을 적용합니다.
            // 🛠️ 수정할 코드 (이 부분으로 통째로 교체해주세요!)
            let pureWrongText = wrongLevelExample.q || "";
            let wrongSvgBlocks = [];

            // 1. 오답 문항의 SVG도 안전하게 대피
            pureWrongText = pureWrongText.replace(/```svg\s*([\s\S]*?)\s*```/gi, (match, innerSvg) => {
                wrongSvgBlocks.push(innerSvg.trim());
                return `%%WRONG_SVG_${wrongSvgBlocks.length - 1}%%`;
            });
            pureWrongText = pureWrongText.replace(/<svg[\s\S]*?<\/svg>/gi, (match) => {
                wrongSvgBlocks.push(match);
                return `%%WRONG_SVG_${wrongSvgBlocks.length - 1}%%`;
            });

            // 2. 줄바꿈 및 선지 정렬 적용
            let formattedWrongQ = pureWrongText.replace(/\n/g, '<br>').replace(/(①|②|③|④|⑤)/g, '<br>&nbsp;&nbsp;$1');

            // 3. 렌더링 박스에 담아 복원
            wrongSvgBlocks.forEach((svgContent, idx) => {
                let safeSvg = svgContent
                    .replace(/<svg/i, '<svg style="max-width: 400px; width: 100%; height: auto; display: block; margin: 0 auto;"')
                    .replace(/width="100%"/i, '')
                    .replace(/height="100%"/i, '');
                const svgBoxHtml = `<div class="svg-box" style="margin-top: 10px; text-align: center; background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0; overflow-x: auto;">${safeSvg}</div>`;
                formattedWrongQ = formattedWrongQ.replace(`%%WRONG_SVG_${idx}%%`, svgBoxHtml);
            });

            comparativeText = `<hr style="margin: 1rem 0; border: 0; border-top: 1px solid #fca5a5;">
                               <div style="text-align: left; font-size: 0.9rem;">
                               <strong>💡 비교해 보세요:</strong><br>
                               선택하신 <strong>'${selectedLevel}'</strong> 수준은 보통 아래와 같은 문항입니다.<br><br>
                               <div style="background: white; padding: 0.8rem; border-radius: 6px; border-left: 4px solid #f87171; margin-bottom: 0.5rem; font-size: 0.85rem; color: #1e293b; line-height: 1.6;">
                                   ${formattedWrongQ}
                               </div>
                               <em>* 현재 제시된 문항은 '${question.level}' 수준의 특징을 더 강하게 가지고 있습니다.</em>
                               </div>`;
        }

        fb.innerHTML = `❌ <strong>오답입니다.</strong> 이 문항은 <strong>'${question.level}'</strong> 수준입니다.<br><br>${fusionNotice}<strong>[이유]</strong> ${question.reason} ${answerHTML} ${comparativeText}`;
        fb.style.color = "#991b1b"; fb.style.backgroundColor = '#fee2e2';
        btn.style.border = '3px solid #ef4444'; btn.style.opacity = '1';
        document.querySelectorAll('#level-options .option-btn').forEach(b => {
            if (b.innerText === question.level) { b.style.backgroundColor = '#dcfce7'; b.style.border = '3px solid #166534'; b.style.opacity = '1'; }
        });
    }
    document.getElementById('next-q-btn').style.display = 'block';
    let feedbackBtn = document.getElementById('invoke-feedback-btn');
    if (!feedbackBtn) {
        feedbackBtn = document.createElement('button');
        feedbackBtn.id = 'invoke-feedback-btn';
        feedbackBtn.className = 'save-btn';
        feedbackBtn.style.marginTop = '10px';
        feedbackBtn.style.background = '#f1f5f9';
        feedbackBtn.style.color = '#475569';
        feedbackBtn.style.border = '1px dashed #94a3b8';
        feedbackBtn.innerHTML = '🙋 이 판정에 이의 있습니다! (의견 보내기)';
        
        document.getElementById('level-feedback').parentNode.appendChild(feedbackBtn);
    }
    feedbackBtn.style.display = 'block';
    feedbackBtn.onclick = () => openSpecificFeedbackPanel();
    if (window.MathJax && window.MathJax.typesetPromise) { MathJax.typesetClear(); MathJax.typesetPromise([fb]); }
}

function nextLevelQuestion() {
    if (currentQuestions.length === 0) return;
    currentLevelQ = (currentLevelQ + 1) % currentQuestions.length;
    loadLevelQuestion();
}

function backToStandardSelection() {
    currentStandardCode = null; 
    currentQuestions = [];
    showSection('dashboard'); 
}

// 💡 중복 실행 방지용 신호등 변수 (반드시 함수 바깥에 선언 유지)
let checklistAborter = 0;

// 💡 체크리스트 목록 렌더링 및 수업일지 '개수 배지' 표시 함수
async function initChecklist() {
    // 함수가 호출될 때마다 번호표 발급
    const currentCall = ++checklistAborter; 
    
    const container = document.getElementById('checklist-container');
    
    // 데이터를 불러오는 동안 임시 문구를 띄워 화면 중첩 방지
    container.innerHTML = '<p style="text-align:center; padding: 2rem; color:#64748b;">데이터 동기화 중입니다... ⏳</p>';

    if (!subjectData[currentSubject]) return;

    let saved = {};
    let journalData = {}; 

    if (auth.currentUser) {
        try {
            // 1. 체크박스 진행 상황 불러오기
            const doc = await db.collection('user_checklists').doc(auth.currentUser.uid).get();
            if (doc.exists) { saved = doc.data()[currentSubject] || {}; }

            // 2. 수업일지 데이터 불러오기
            const journalDoc = await db.collection('user_journals').doc(auth.currentUser.uid).get();
            if (journalDoc.exists) {
                const allJournals = journalDoc.data();
                journalData = allJournals[currentSubject] || {};
            }
        } catch (e) { console.warn("DB 로드 실패"); }
    } else {
        saved = JSON.parse(localStorage.getItem('check_' + currentSubject)) || {};
    }

    // ✨ [핵심 방어막] 내가 가장 마지막에 불린 '최신 호출'이 아니면 렌더링을 멈춤
    if (currentCall !== checklistAborter) return;

    // 최신 호출임이 확인되었으니 안전하게 화면 비우기
    container.innerHTML = "";

    // 1. 엑셀 다운로드 버튼 생성 
    const headerDiv = document.createElement('div');
    headerDiv.style.cssText = "text-align: right; margin-bottom: 10px;";
    headerDiv.innerHTML = `<button id="journal-excel-btn" onclick="downloadAllJournalsExcel()" style="background: #10b981; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 0.85rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); transition: 0.2s;">📥 내 모든 수업일지 엑셀 다운로드</button>`;
    container.appendChild(headerDiv);

    const standards = subjectData[currentSubject].standards;
    
    // 💡 [선생님 요청 반영] 중단원(category) 필드가 하나라도 입력되어 있는지 체크
    const hasCategory = standards.some(std => std.category && std.category.trim() !== "");

    if (hasCategory) {
        // [A안] 중단원이 존재하는 경우: 단원별 그룹화 처리
        const groupedStandards = {};
        standards.forEach(std => {
            const cat = std.category || '미분류 단원';
            if (!groupedStandards[cat]) groupedStandards[cat] = [];
            groupedStandards[cat].push(std);
        });

        for (const category in groupedStandards) {
            // 단원별 제목(헤더) 추가
            const catHeader = document.createElement('div');
            catHeader.style.cssText = "background: #e0e7ff; color: #1e40af; padding: 8px 12px; border-radius: 6px; font-weight: bold; font-size: 0.9rem; margin-top: 1.5rem; margin-bottom: 10px;";
            catHeader.innerText = `📁 ${category}`;
            container.appendChild(catHeader);

            // 해당 단원의 항목들만 그리기
            groupedStandards[category].forEach(std => {
                renderChecklistItemRow(std, container, saved, journalData);
            });
        }
    } else {
        // [B안] 중단원이 아예 없는 경우: 대단원/소제목 헤더 없이 순서대로 바로 나열
        standards.forEach(std => {
            renderChecklistItemRow(std, container, saved, journalData);
        });
    }
}


function renderChecklistItemRow(std, container, saved, journalData) {
    const div = document.createElement('div');
    div.className = 'check-item';
    div.style.cssText = 'display: flex; justify-content: space-between; align-items: center; background: var(--card-bg); padding: 1rem; margin-bottom: 0.5rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);';
    
    const leftDiv = document.createElement('div');
    leftDiv.style.cssText = 'display: flex; align-items: center; flex: 1; margin-right: 10px;';
    const safeDesc = std.desc.replace(/'/g, "\\'").replace(/"/g, '&quot;'); 
    leftDiv.innerHTML = `
        <input type="checkbox" id="c-${std.code}" ${saved[std.code]?'checked':''} onchange="silentSaveChecklist()" style="margin-right: 1rem; transform: scale(1.5); cursor: pointer; flex-shrink: 0;">
        <label for="c-${std.code}" style="cursor: pointer; line-height: 1.5;"><strong>${std.code}</strong> ${std.desc}</label>
    `;
    
    const entries = journalData[std.code] || [];
    const jCount = entries.length;
    let badgeHtml = "";
    if (jCount > 0) {
        badgeHtml = `<span style="background: #ef4444; color: white; padding: 2px 6px; border-radius: 12px; font-size: 0.7rem; margin-left: 5px; box-shadow: 0 1px 2px rgba(0,0,0,0.2);">${jCount}</span>`;
    }

    const rightDiv = document.createElement('div');
    rightDiv.innerHTML = `<button onclick="openJournalModal('${std.code}', '${safeDesc}')" style="background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; padding: 6px 12px; border-radius: 6px; font-size: 0.85rem; font-weight: bold; cursor: pointer; white-space: nowrap; box-shadow: 0 1px 2px rgba(0,0,0,0.05); transition: 0.2s;" onmouseover="this.style.background='#dbeafe'" onmouseout="this.style.background='#eff6ff'">📖 수업일지 ${badgeHtml}</button>`;

    div.appendChild(leftDiv);
    div.appendChild(rightDiv);
    container.appendChild(div);
}

// ==========================================
// 📖 수업일지 및 체크리스트 관리 로직
// ==========================================

// 1. 체크리스트 전체 초기화 함수 (수업일지는 보호됨)
async function resetChecklist() {
    const subjectName = document.getElementById('detail-subjects').options[document.getElementById('detail-subjects').selectedIndex]?.text || currentSubject;
    
    if(!confirm(`정말로 이번 학기 '${subjectName}' 과목의 체크리스트를 모두 초기화하시겠습니까?\n\n(※ 안심하세요! 작성해 둔 '수업일지' 기록은 초기화되지 않고 안전하게 유지됩니다.)`)) return;

    document.querySelectorAll('#checklist-container input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
    });

    if (auth.currentUser) {
        try {
            await db.collection('user_checklists').doc(auth.currentUser.uid).set({
                [currentSubject]: {},
                email: auth.currentUser.email,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            alert("✅ 체크리스트가 깨끗하게 초기화되었습니다. 새로운 학기를 힘차게 시작하세요!");
        } catch(e) {
            alert("초기화 중 오류 발생: " + e.message);
        }
    } else {
        localStorage.setItem('check_' + currentSubject, JSON.stringify({}));
        alert("✅ 체크리스트가 초기화되었습니다.");
    }
}

// 2. 수업일지용 변수 및 날짜 헬퍼
let currentJournalStdCode = '';

function getTodayDateString() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// 3. 수업일지 팝업창 열기
// 3. 수업일지 팝업창 열기 (과목별 맞춤 팁 적용)
async function openJournalModal(code, desc) {
    currentJournalStdCode = code;
    document.getElementById('journal-std-code').innerText = code;
    document.getElementById('journal-std-desc').innerText = desc;
    
    document.getElementById('journal-date').value = getTodayDateString();
    document.getElementById('journal-title').value = '';
    document.getElementById('journal-content').value = '';

    // ✨ 교과별 맞춤 팁 및 수식 입력기 가리기 로직
    const mathTip = document.getElementById('journal-math-tip');
    const tipText = document.getElementById('journal-tip-text');
    
    // 수학 과목군 배열 (선생님 시스템의 수학 코드들)
    const mathSubjects = ['common1', 'common2', 'algebra', 'calculus1', 'calculus2', 'geometry', 'stats', 'ai-math'];
    
    if (mathSubjects.includes(currentSubject)) {
        // 수학 과목일 때: 수식 안내 ON, 수학용 팁
        mathTip.style.display = 'block';
        tipText.innerHTML = "개념 설명 방식, 학생들의 자주 틀리는 오개념, 다음 시간 유의점 등을 기록하세요.";
    } else if (currentSubject === 'science' || currentSubject.includes('sci')) {
        // 과학 관련 과목일 때: 수식 안내 OFF, 심화/면접용 팁
        mathTip.style.display = 'none';
        tipText.innerHTML = "단백질 구조 예측, 유전체 의학, 의료 윤리 등 심화 주제에 대한 학생들의 질문이나 토론 내용을 기록해 두면 의약학계열 진학 지도 시 훌륭한 자료가 됩니다.";
    } else {
        // 그 외 과목일 때: 수식 안내 OFF, 기본 팁
        mathTip.style.display = 'none';
        tipText.innerHTML = "오늘 수업의 핵심, 학생들의 반응, 다음 시간 유의점 등을 기록하세요.";
    }

    document.getElementById('journal-modal').style.display = 'flex';
    
    await loadJournalEntries(code);
}

function closeJournalModal() {
    document.getElementById('journal-modal').style.display = 'none';
    currentJournalStdCode = '';
}

// 4. DB에서 누적된 수업일지 불러오기 (새로운 서랍: user_journals 사용)
async function loadJournalEntries(code) {
    const container = document.getElementById('journal-list-container');
    container.innerHTML = '<p style="text-align:center; color:#64748b; font-size:0.9rem; padding: 1rem;">기록을 불러오는 중... ⏳</p>';

    if (!auth.currentUser) {
        container.innerHTML = '<p style="text-align:center; color:#ef4444; font-size:0.9rem; padding: 1rem;">로그인이 필요합니다.</p>';
        return;
    }

    try {
        const docRef = db.collection('user_journals').doc(auth.currentUser.uid);
        const doc = await docRef.get();
        
        let entries = [];
        if (doc.exists) {
            const data = doc.data();
            if (data[currentSubject] && data[currentSubject][code]) {
                entries = data[currentSubject][code];
            }
        }

        // 최신 날짜가 위로 오도록 정렬
        entries.sort((a, b) => new Date(b.date) - new Date(a.date));
        renderJournalEntries(entries);

    } catch (e) {
        container.innerHTML = '<p style="text-align:center; color:#ef4444; font-size:0.9rem;">기록을 불러오지 못했습니다.</p>';
        console.error("일지 로드 에러:", e);
    }
}

// 5. 화면에 일지 예쁘게 그리기 (수식 변환 포함)
function renderJournalEntries(entries) {
    const container = document.getElementById('journal-list-container');
    container.innerHTML = '';

    if (entries.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding: 2rem; background: white; border-radius: 8px; border: 1px dashed #cbd5e1; color: #94a3b8; font-size: 0.95rem;">아직 기록이 없습니다.<br>오늘 수업의 첫 일지를 작성해 보세요!</div>';
        return;
    }

    entries.forEach(entry => {
        const dayOfWeek = new Date(entry.date).toLocaleDateString('ko-KR', { weekday: 'short' }); 
        const displayDate = `${entry.date} (${dayOfWeek})`;
        const div = document.createElement('div');
        
        // 💡 [핵심 수정] height를 220px로 고정하고, flex 레이아웃으로 변경
        div.style.cssText = 'background: white; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); position: relative; height: 220px; display: flex; flex-direction: column; margin-bottom: 15px;';
        
        const formattedContent = entry.content.replace(/\n/g, '<br>');

        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px; flex-shrink: 0;">
                <div>
                    <span style="font-size: 0.8rem; background: #e0e7ff; color: #3730a3; padding: 3px 8px; border-radius: 4px; font-weight: bold; margin-right: 8px;">📅 ${displayDate}</span>
                    <strong style="font-size: 1rem; color: #1e293b;">${entry.title || '제목 없음'}</strong>
                </div>
                <button onclick="deleteJournalEntry('${entry.id}')" style="background: #fee2e2; border: 1px solid #fca5a5; color: #ef4444; border-radius: 4px; cursor: pointer; font-size: 0.8rem; padding: 3px 8px; font-weight: bold; transition: 0.2s;">🗑️ 삭제</button>
            </div>
            <div style="font-size: 0.95rem; color: #334155; line-height: 1.6; overflow-y: auto; flex-grow: 1; padding-right: 5px;">
                ${formattedContent}
            </div>
        `;
        container.appendChild(div);
    });

    // 💡 화면에 그린 후 선생님이 쓴 달러($) 기호를 인식해서 수식으로 자동 변환!
    if (window.MathJax) {
        MathJax.typesetClear([container]);
        MathJax.typesetPromise([container]).catch(err => console.error("수식 에러:", err));
    }
}

// 6. 새로운 일지 등록하기
async function saveJournalEntry() {
    const date = document.getElementById('journal-date').value;
    const title = document.getElementById('journal-title').value.trim();
    const content = document.getElementById('journal-content').value.trim();

    if (!date || !content) {
        alert("날짜와 일지 내용을 모두 입력해 주세요.");
        return;
    }

    const newEntry = {
        id: 'jrn_' + Date.now() + Math.random().toString(36).substr(2, 5),
        date: date,
        title: title,
        content: content,
        timestamp: new Date().toISOString(),
        email: auth.currentUser.email
    };

    const btn = document.querySelector('#journal-modal .save-btn');
    const originalText = btn.innerText;
    btn.innerText = "⏳ 저장 중...";
    btn.disabled = true;

    try {
        const docRef = db.collection('user_journals').doc(auth.currentUser.uid);
        const doc = await docRef.get();
        let data = doc.exists ? doc.data() : {};
        
        if (!data[currentSubject]) data[currentSubject] = {};
        if (!data[currentSubject][currentJournalStdCode]) data[currentSubject][currentJournalStdCode] = [];
        
        data[currentSubject][currentJournalStdCode].push(newEntry);

        await docRef.set(data, { merge: true });
        
        document.getElementById('journal-title').value = '';
        document.getElementById('journal-content').value = '';
        await loadJournalEntries(currentJournalStdCode); // 다시 불러와서 즉시 화면에 띄우기

        initChecklist(); // ✨ 추가: 뒷배경의 체크리스트 숫자 배지도 즉시 갱신!

    } catch (e) {
        alert("일지 저장 실패: " + e.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

// 7. 일지 삭제하기
async function deleteJournalEntry(entryId) {
    if (!confirm("이 수업일지를 삭제하시겠습니까? (삭제 후 복구할 수 없습니다.)")) return;

    try {
        const docRef = db.collection('user_journals').doc(auth.currentUser.uid);
        const doc = await docRef.get();
        if (!doc.exists) return;

        let data = doc.data();
        if (data[currentSubject] && data[currentSubject][currentJournalStdCode]) {
            data[currentSubject][currentJournalStdCode] = data[currentSubject][currentJournalStdCode].filter(e => e.id !== entryId);
            await docRef.set(data, { merge: true });
            await loadJournalEntries(currentJournalStdCode); // 삭제 후 화면 즉시 갱신

            initChecklist(); // ✨ 추가: 뒷배경의 체크리스트 숫자 배지도 즉시 갱신!
        }
    } catch (e) {
        alert("삭제 실패: " + e.message);
    }
}

async function saveChecklist() {
    const isLoggedIn = await checkLogin();
    if (!isLoggedIn) return;

    const checks = {};
    document.querySelectorAll('#checklist-container input').forEach(input => {
        checks[input.id.replace('c-', '')] = input.checked;
    });

    try {
        await db.collection('user_checklists').doc(auth.currentUser.uid).set({
            [currentSubject]: checks
        }, { merge: true });
        alert("✅ 진행 상황이 클라우드에 안전하게 저장되었습니다.\n(다음에 접속해도 유지됩니다.)");
    } catch (e) {
        console.error("저장 실패:", e);
        alert("⚠️ 저장 중 오류가 발생했습니다.");
    }
}
// [추가 1] 체크박스를 누를 때마다 조용히 DB에 저장하는 함수 (체크 증발 방지)
let checklistTimeout = null;
let pendingChecklistData = null; // 창이 닫힐 때를 대비해 마지막 상태를 기억할 변수

async function silentSaveChecklist() {
    if (!auth.currentUser) return;
    
    const checks = {};
    document.querySelectorAll('#checklist-container input[type="checkbox"]').forEach(input => {
        checks[input.id.replace('c-', '')] = input.checked;
    });

    // 전송할 데이터를 보관해둡니다 (창이 갑자기 닫힐 때를 대비)
    pendingChecklistData = checks;

    // 기존 예약된 저장이 있다면 취소하고 다시 1.5초를 셉니다.
    if (checklistTimeout) {
        clearTimeout(checklistTimeout);
    }

    checklistTimeout = setTimeout(async () => {
        try {
            await db.collection('user_checklists').doc(auth.currentUser.uid).set({
                [currentSubject]: pendingChecklistData
            }, { merge: true });
            
            pendingChecklistData = null; // 안전하게 저장되었으므로 보류 데이터를 비웁니다.
            console.log("✅ 체크리스트 일괄 안전 저장 완료");
        } catch (e) {
            console.error("체크리스트 자동 저장 실패:", e);
        }
    }, 1500);
}

// 🚨 안전장치: 사용자가 1.5초가 되기 전에 브라우저 창을 닫거나 새로고침할 때 발동
window.addEventListener('beforeunload', () => {
    // 저장되지 않고 대기 중인 데이터가 있다면 창이 닫히기 직전에 즉시 DB에 기록 요청
    if (pendingChecklistData && auth.currentUser) {
        db.collection('user_checklists').doc(auth.currentUser.uid).set({
            [currentSubject]: pendingChecklistData
        }, { merge: true });
    }
});

// [추가 2] 내가 쓴 모든 수업일지를 엑셀로 한 번에 다운로드하는 마법의 함수
async function downloadAllJournalsExcel() {
    if (!auth.currentUser) {
        alert("로그인이 필요합니다.");
        return;
    }
    
    const btn = document.getElementById('journal-excel-btn');
    const originalText = btn.innerText;
    btn.innerText = "⏳ 엑셀 파일 생성 중...";
    btn.disabled = true;

    try {
        const docRef = db.collection('user_journals').doc(auth.currentUser.uid);
        const doc = await docRef.get();
        
        if (!doc.exists || Object.keys(doc.data()).length === 0) {
            alert("작성된 수업일지가 없습니다.");
            return;
        }
        
        const data = doc.data();
        let excelData = [["과목(교과)", "성취기준", "작성 날짜", "일지 제목", "일지 내용"]];
        
        for (const subjectCode in data) {
            // 과목명 한글로 예쁘게 변환
            let subjectName = subjectData[subjectCode] ? subjectData[subjectCode].title : subjectCode;
            
            for (const stdCode in data[subjectCode]) {
                const entries = data[subjectCode][stdCode];
                entries.forEach(entry => {
                    excelData.push([
                        subjectName,
                        stdCode,
                        entry.date,
                        entry.title || '제목 없음',
                        entry.content || ''
                    ]);
                });
            }
        }
        
        if (excelData.length === 1) {
            alert("작성된 수업일지 내용이 없습니다.");
            return;
        }
        
        const ws = XLSX.utils.aoa_to_sheet(excelData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "수업일지 전체 백업");
        XLSX.writeFile(wb, `수업일지_전체백업_${new Date().toISOString().split('T')[0]}.xlsx`);
        
    } catch (e) {
        alert("엑셀 다운로드 실패: " + e.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

function openModal(std) {
    document.getElementById('modal-title').innerText = std.code;
    document.getElementById('modal-desc').innerText = std.desc;
    
    if (std.levels) {
        document.getElementById('level-high').innerText = std.levels.high || "";
        document.getElementById('level-b').innerText = std.levels.b || (std.levels.high ? std.levels.high.replace("이해하여 설명할 수 있으며", "설명할 수 있고") : "");
        document.getElementById('level-mid').innerText = std.levels.mid || "";
        document.getElementById('level-d').innerText = std.levels.d || (std.levels.mid ? std.levels.mid.replace("이해하고", "알고") : "");
        document.getElementById('level-low').innerText = std.levels.low || "";
    } else {
        document.getElementById('level-high').innerText = "데이터 없음";
        document.getElementById('level-b').innerText = "데이터 없음";
        document.getElementById('level-mid').innerText = "데이터 없음";
        document.getElementById('level-d').innerText = "데이터 없음";
        document.getElementById('level-low').innerText = "데이터 없음";
    }
    
    document.getElementById('level-modal').style.display = 'flex';

    if (window.MathJax) {
        MathJax.typesetPromise([document.getElementById('level-modal')]).catch(err => console.error(err));
    }
}

async function reAnalyzeWithChat() {
    const isLoggedIn = await checkLogin();
    if (!isLoggedIn) return;
    if (!requireApiKey()) return;

    const chatHistory = document.getElementById('chat-history').innerText;
    if (!chatHistory) { alert("먼저 대화를 진행해주세요."); return; }

    const resultDiv = document.getElementById('analysis-result');
    const resultText = document.getElementById('result-text');
    
    const originalContent = resultText.innerHTML;
    resultText.innerHTML = '<div style="text-align:center; padding: 3rem; color: #3b82f6; font-weight: bold; font-size: 1.1rem;">AI 교사가 대화를 바탕으로 재분석 중입니다... ⏳</div>';

    try {
        const workerUrl = "https://script.google.com/macros/s/AKfycbwgx4RgF8FQxxL3jBgEQ5l369llADjhZ1NepulIdF4DdX18kBrB8oRQ4Ft0d5WdKtEF/exec";
        const userApiKey = localStorage.getItem('gemini_api_key');
        const response = await fetch(workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: "reanalyze_chat",
                analysisMainMode: analysisMainMode,
                currentChatContext: currentChatContext,
                chatHistory: chatHistory,
                apiKey: userApiKey
            })
        });
        
        await checkApiError(response); 
        const result = await response.json();

        // 🚀 [추가된 핵심 방어막]
        if (result.error) {
            const errMsg = typeof result.error === 'string' ? result.error : (result.error.message || JSON.stringify(result.error));
            throw new Error(`AI 통신 에러: ${errMsg}`);
        }
        if (!result.candidates || result.candidates.length === 0 || !result.candidates[0].content) {
            throw new Error("AI가 정상적인 재분석 결과를 생성하지 못했습니다.");
        }

        const analysisText = result.candidates[0].content.parts[0].text;
        currentChatContext = analysisText;

        if (analysisMainMode === 'single') {
            renderSophisticatedResult(analysisText, lastAnalyzedSingleImage);
        } else {
            let rawText = analysisText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
            let imagesHtml = '<div style="display: flex; gap: 15px; overflow-x: auto; margin-bottom: 1.5rem; padding-bottom: 10px; border-bottom: 2px dashed #cbd5e1;">';
            cropBoxes.forEach((box, i) => {
                imagesHtml += `
                    <div style="flex: 0 0 auto; text-align: center;">
                        <span style="display: block; font-size: 0.85rem; font-weight: bold; color: #ef4444; margin-bottom: 5px;">[문항 ${i+1}]</span>
                        <img src="data:image/jpeg;base64,${getCroppedBase64(box)}" style="height: 120px; border: 1px solid #cbd5e1; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    </div>`;
            });
            imagesHtml += '</div>';
            resultText.innerHTML = `<div style="background: white; padding: 1.5rem; border-radius: 12px; border: 1px solid var(--border); line-height: 1.8;">${imagesHtml}${rawText}</div>`;
        }

        if (window.MathJax) MathJax.typesetPromise();
    } catch (error) { 
        alert("⚠️ 재분석 오류:\n" + error.message); 
        resultText.innerHTML = originalContent; 
    }
}

async function sendChatMessage() {
    const inputEl = document.getElementById('chat-input');
    const message = inputEl.value.trim();
    if(!message) return;
    
    const historyEl = document.getElementById('chat-history');
    historyEl.innerHTML += `<div style="text-align: right; margin-bottom: 12px;"><span style="background: #e0e7ff; color: #1e40af; padding: 10px 14px; border-radius: 16px 16px 0 16px; display: inline-block; text-align: left; max-width: 80%">${message}</span></div>`;
    inputEl.value = '';
    historyEl.scrollTop = historyEl.scrollHeight;

    const loadingId = 'loading-' + Date.now();
    historyEl.innerHTML += `<div id="${loadingId}" style="text-align: left; margin-bottom: 12px;"><span style="background: #f3f4f6; color: #4b5563; padding: 10px 14px; border-radius: 16px 16px 16px 0; display: inline-block; font-size: 0.9rem;">판정 기준을 엄격하게 재검토 중입니다... ⏳</span></div>`;
    historyEl.scrollTop = historyEl.scrollHeight;

    try {
        let standardsText = "";
        if (typeof subjectData !== 'undefined') {
            for (const key in subjectData) {
                if (subjectData[key].standards && subjectData[key].standards.length > 0) {
                    standardsText += `\n--- ${subjectData[key].title} ---\n`;
                    standardsText += subjectData[key].standards.map(s => `${s.code} ${s.desc}`).join('\n');
                }
            }
        }

        const workerUrl = "https://script.google.com/macros/s/AKfycbwgx4RgF8FQxxL3jBgEQ5l369llADjhZ1NepulIdF4DdX18kBrB8oRQ4Ft0d5WdKtEF/exec";
        const userApiKey = localStorage.getItem('gemini_api_key');
        
        const response = await fetch(workerUrl, {
            method: 'POST', 
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ 
                action: "chat_message", 
                currentChatContext: currentChatContext,
                subject: currentSubject,
                standardsInfo: standardsText, 
                message: message,
                apiKey: userApiKey
            })
        });
        
        if (!response.ok) throw new Error("백엔드 챗봇 엔진 통신 실패");
        const result = await response.json();
        
        // 🚀 [추가된 핵심 방어막] 에러 데이터가 오면 먹통이 되지 않고 붉은 경고를 출력합니다.
        if (result.error) {
            const errMsg = typeof result.error === 'string' ? result.error : (result.error.message || JSON.stringify(result.error));
            throw new Error(`AI 통신 오류: ${errMsg}`);
        }
        if (!result.candidates || result.candidates.length === 0) {
            throw new Error("AI가 정상적인 답변을 생성하지 못했습니다.");
        }
        // 🚀 안전 정책(Safety) 제한 방어
        if (!result.candidates[0].content) {
            throw new Error(`안전 정책 제한으로 AI가 답변을 거부했습니다. (사유: ${result.candidates[0].finishReason})`);
        }

        const aiReply = result.candidates[0].content.parts[0].text;
        
        if (aiReply.includes("성취수준:") && aiReply.includes("판정 이유:")) {
            currentChatContext = aiReply;
        }

        const loadingEl = document.getElementById(loadingId);
        if(loadingEl) loadingEl.remove();

        const formattedReply = aiReply.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
        historyEl.innerHTML += `<div style="text-align: left; margin-bottom: 12px;"><span style="background: white; border: 1px solid var(--border); padding: 12px 16px; border-radius: 16px 16px 16px 0; display: inline-block; max-width: 85%;">${formattedReply}</span></div>`;
        
        if (window.MathJax && window.MathJax.typesetPromise) { 
            MathJax.typesetClear(); 
            MathJax.typesetPromise([historyEl]); 
        }
        historyEl.scrollTop = historyEl.scrollHeight;

    } catch(e) { 
        const loadingEl = document.getElementById(loadingId);
        if(loadingEl) loadingEl.remove();
        historyEl.innerHTML += `<div style="text-align: left; margin-bottom: 12px;"><span style="color: #dc2626; background: #fee2e2; padding: 10px; border-radius: 8px; display: inline-block; font-size: 0.9rem; font-weight: bold;">⚠️ ${e.message}</span></div>`; 
        historyEl.scrollTop = historyEl.scrollHeight;
    }
}

async function syncPendingFeedback() {
    let pending = JSON.parse(localStorage.getItem('pending_feedback')) || [];
    if (pending.length === 0) return; 

    let remaining = [];
    for (let item of pending) {
        try {
            await db.collection('developer_feedback').add({
                text: "[지연 전송됨] " + item.text,
                user_email: item.user_email || "이메일 정보 없음",
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (e) {
            remaining.push(item);
        }
    }
    localStorage.setItem('pending_feedback', JSON.stringify(remaining));
}

// 💡 교체해야 할 올바른 동기화 함수
async function syncPendingVariants() {
    // 중복 실행(따닥 클릭 등) 방지용 신호등
    if (sessionStorage.getItem('is_syncing_variants') === 'true') return;
    
    let pending = JSON.parse(localStorage.getItem('pending_variants')) || [];
    if (pending.length === 0) return; 

    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) return;

    sessionStorage.setItem('is_syncing_variants', 'true');
    console.log(`⏳ 통신 장애로 밀려있던 ${pending.length}개의 문항을 DB로 안전하게 밀어 넣습니다...`);
    
    // for문 대신 while문 사용: 성공할 때마다 즉각적으로 로컬 배열에서 하나씩 삭제!
    while (pending.length > 0) {
        let item = pending[0]; 
        try {
            await processAndSaveBackground(item.analysisText, apiKey, true); 
            
            // 성공 시 맨 앞 데이터를 잘라내고, 로컬 저장소 즉시 덮어쓰기
            pending.shift(); 
            localStorage.setItem('pending_variants', JSON.stringify(pending));
        } catch (e) {
            console.log("통신 지연이 발생하여 남은 항목은 다음 번에 시도합니다.");
            break; // 통신 에러가 나면 즉시 정지하여 남은 데이터 보존
        }
    }
    
    sessionStorage.removeItem('is_syncing_variants');
}

let subjectData = {}; 
let isDbLoaded = false;
let dbLoadPromise = null; // 💡 DB 로딩 완료를 기다려줄 신호등

async function loadStandardsFromDB() {
    try {
        // 💡 [최적화 방어막] 영구 수첩(localStorage) 확인 및 버전 검사
        const cachedData = localStorage.getItem('saved_subject_data');
        const cachedVersion = localStorage.getItem('saved_app_version');

        // 내 수첩의 버전과 선생님이 배포한 최신 버전(CURRENT_VERSION)이 같을 때만 수첩에서 꺼냅니다.
        if (cachedData && cachedVersion === CURRENT_VERSION) {
            console.log(`⚡ 영구 수첩에서 성취기준을 0초 만에 불러옵니다! (버전: ${CURRENT_VERSION})`);
            subjectData = JSON.parse(cachedData);
            isDbLoaded = true;
            return; // DB 요청 안 함!
        }

        // 💡 [로딩 켜기] 버전이 다르거나 최초 접속이면 예쁜 화면으로 덮어버립니다!
        showSystemLoading();
        console.log(`⏳ [새 버전 감지 또는 최초 접속] DB에서 시스템 데이터를 다운로드합니다...`);

        // 🌟 [여기서부터 선생님 원본 코드와 100% 동일] 🌟
        for (const group in curriculumMap) {
            for (const category in curriculumMap[group]) {
                curriculumMap[group][category].forEach(sub => {
                    subjectData[sub.id] = {
                        title: sub.name,
                        subtitle: "과목 정보가 등록되어 있습니다.",
                        standards: [] 
                    };
                });
            }
        }
        if (!subjectData['uncategorized']) {
            subjectData['uncategorized'] = { title: '미분류 보관함', subtitle: '분류되지 않은 데이터', standards: [] };
        }

        const subjectSnapshot = await db.collection('subjects').get();
        subjectSnapshot.forEach(doc => {
            const data = doc.data();
            if (!subjectData[doc.id]) subjectData[doc.id] = { standards: [] };
            if (data.title) subjectData[doc.id].title = data.title;
            if (data.subtitle) subjectData[doc.id].subtitle = data.subtitle;
        });

        const standardsSnapshot = await db.collection('standards_2022').get();
        standardsSnapshot.forEach(doc => {
            const data = doc.data();
            if(subjectData[data.subject]) {
                subjectData[data.subject].standards.push({
                    id: doc.id,
                    code: data.code,
                    category: data.category || "단원 미지정", // 💡 카테고리 항목 추가!
                    desc: data.desc,
                    levels: data.levels,
                    questions: data.questions || []
                });
            }
        });

        for (let subj in subjectData) {
            if (subjectData[subj].standards.length > 0) {
                subjectData[subj].standards.sort((a, b) => a.code.localeCompare(b.code));
            }
        }
        // 🌟 [선생님 원본 코드 끝] 🌟

        // 💡 [최적화 완료] 새로 받은 데이터와 '현재 배포 버전'을 영구 수첩에 함께 저장합니다.
        localStorage.setItem('saved_subject_data', JSON.stringify(subjectData));
        localStorage.setItem('saved_app_version', CURRENT_VERSION);

        isDbLoaded = true; 
        console.log(`✅ 시스템 데이터 세팅 및 영구 수첩 저장 완료 (적용 버전: ${CURRENT_VERSION})`);
        
    } catch(error) {
        console.error("DB 로딩 에러:", error);
        isDbLoaded = true; 
    } finally {
        // 💡 [로딩 끄기] 작업이 끝났거나 에러가 나도 무조건 로딩 화면을 치워줍니다!
        hideSystemLoading();
    }
}

// 💡 스크립트가 읽히자마자 즉시 DB 다운로드를 시작하고, 그 약속(Promise)을 보관합니다.
dbLoadPromise = loadStandardsFromDB();



async function checkLogin() {
    if (!auth.currentUser) {
        alert("이 기능을 사용하려면 '구글 아이디로 시작' 로그인이 필요합니다.\n확인을 누르면 로그인 화면으로 이동합니다.");
        try {
            await auth.signInWithPopup(provider);
            return true; 
        } catch (error) {
            console.error("로그인 취소 또는 실패", error);
            return false; 
        }
    }
    return true; 
}

function openAdminMode() {
    const user = auth.currentUser;
    if (user && user.email === "kthblacks11@gmail.com") {
        showSection('admin-dashboard');
    } else {
        alert("관리자만 접근 가능한 페이지입니다.");
    }
}

async function saveStandardToDB() {
    const subject = document.getElementById('admin-subject').value;
    const code = document.getElementById('admin-code').value.trim();
    const desc = document.getElementById('admin-desc').value.trim();
    
    const levels = {
        high: document.getElementById('admin-level-high').value.trim(),
        b: document.getElementById('admin-level-b').value.trim(),
        mid: document.getElementById('admin-level-mid').value.trim(),
        d: document.getElementById('admin-level-d').value.trim(),
        low: document.getElementById('admin-level-low').value.trim()
    };

    if (!code || !desc || !levels.high) {
        alert("성취기준 코드와 내용은 필수 입력 사항입니다.");
        return;
    }

    try {
        await db.collection('standards_2022').add({
            subject: subject,
            code: code,
            desc: desc,
            levels: levels,
            questions: [] 
        });
        alert("🎉 새로운 성취기준이 DB에 성공적으로 저장되었습니다!");
        
        // 💡 [핵심 추가] 관리자가 직접 추가했으니 내 브라우저 수첩을 찢어버림!
        localStorage.removeItem('saved_subject_data'); 
        
        location.reload(); 
    } catch (error) {
        console.error("저장 실패:", error);
        alert("저장 중 오류가 발생했습니다: " + error.message);
    }
}

async function loadStandardsForQuestion() {
    const subject = document.getElementById('admin-q-subject').value;
    const stdSelect = document.getElementById('admin-q-standard');
    stdSelect.innerHTML = '<option value="">데이터를 불러오는 중입니다...</option>';

    if (!subject) {
        stdSelect.innerHTML = '<option value="">위에서 과목을 먼저 선택하세요</option>';
        return;
    }

    try {
        const snapshot = await db.collection('standards_2022').where('subject', '==', subject).get();
        let stds = [];
        snapshot.forEach(doc => stds.push({ id: doc.id, code: doc.data().code, desc: doc.data().desc }));
        
        stds.sort((a,b) => a.code.localeCompare(b.code));

        stdSelect.innerHTML = '<option value="">-- 문항을 추가할 성취기준 선택 --</option>';
        stds.forEach(std => {
            stdSelect.innerHTML += `<option value="${std.id}">${std.code} ${std.desc.substring(0, 25)}...</option>`;
        });
    } catch (error) {
        console.error("목록 불러오기 실패:", error);
        stdSelect.innerHTML = '<option value="">불러오기 오류 발생</option>';
    }
    
}

async function saveQuestionToDB() {
    const stdSelect = document.getElementById('admin-q-standard');
    const docId = stdSelect.value;
    const stdCode = stdSelect.options[stdSelect.selectedIndex].text.split(' ')[0]; // 코드만 추출
    const subject = document.getElementById('admin-q-subject').value;
    const qText = document.getElementById('admin-q-text').value.trim();
    const qAnswer = document.getElementById('admin-q-answer').value.trim();
    const qLevel = document.getElementById('admin-q-level').value; // A, B, C...
    const qReason = document.getElementById('admin-q-reason').value.trim();

    if (!docId || !qText || !qReason) {
        alert("모든 빈칸을 채워주세요!");
        return;
    }

    try {
        // 🌟 통합 서랍(transformed_bank)에 직접 저장
        await db.collection('transformed_bank').add({
            subject: subject,
            standard_code: [stdCode.replace(/[\[\]\s]/g, '')],
            question: qText,
            answer: qAnswer || "정답 정보 없음",
            level: qLevel,
            reason: qReason,
            source: "선생님 직접 등록",
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });
        alert("✨ 문항이 통합 서랍에 성공적으로 저장되었습니다!");
        
        await updateQuestionCount();
        // 입력창 비우기
        document.getElementById('admin-q-text').value = '';
        document.getElementById('admin-q-answer').value = '';
        document.getElementById('admin-q-reason').value = '';
    } catch (error) {
        alert("저장 실패: " + error.message);
    }
}

let currentBookmarkQuestions = [];

function resetBookmarkView() {
    document.getElementById('bookmark-list').innerHTML = "";
}

// 🟢 이 변수는 반드시 함수 바깥(위에) 있어야 합니다! 기존에 없다면 꼭 같이 복사해주세요.
let bookmarkSnapshotUnsubscribe = null;

// 👇 [핵심 추가] DB 중복 호출을 막기 위한 메모리 수첩 변수
let cachedBookmarkData = null;
let lastBookmarkSubject = null;

// 🟢 실시간 감시(onSnapshot)를 끄고 1회성 읽기(get) 및 메모리 캐싱으로 데이터를 획기적으로 절약한 북마크 로직
async function loadBookmark(level) {
    // ✨ 1. 모든 버튼을 살짝 투명하게 만들고 크기를 원래대로 되돌림 (선생님 코드 100% 유지)
    ['A', 'B', 'C', 'D', 'E'].forEach(l => {
        const btn = document.getElementById(`bm-btn-${l}`);
        if (btn) {
            btn.style.opacity = '0.4';
            btn.style.transform = 'scale(1)';
            btn.style.border = '3px solid transparent';
            btn.style.boxShadow = 'none';
        }
    });

    // ✨ 2. 방금 클릭한 버튼만 뚜렷하게, 크고, 진한 테두리로 강조 (선생님 코드 100% 유지)
    const activeBtn = document.getElementById(`bm-btn-${level}`);
    if (activeBtn) {
        activeBtn.style.opacity = '1';
        activeBtn.style.transform = 'scale(1.15)'; 
        activeBtn.style.border = '3px solid #0f172a'; 
        activeBtn.style.boxShadow = '0 4px 10px rgba(0,0,0,0.2)'; 
    }

    const subject = currentSubject || "uncategorized"; 
    const listContainer = document.getElementById('bookmark-list');

    try {
        currentBookmarkQuestions = []; // 배열 초기화

        // 🚨 [핵심 변경 1] 과목이 바뀌었거나 처음 누를 때만 딱 1번 DB에서 다운로드합니다! (비용 절감)
        if (lastBookmarkSubject !== subject || !cachedBookmarkData) {
            listContainer.innerHTML = "<p style='text-align:center; color:var(--primary); font-weight:bold;'>데이터베이스에서 문항을 최초 1회 불러오는 중입니다... ⏳</p>";
            
            let query;
            if (subject === "uncategorized") {
                query = db.collection('transformed_bank').get(); 
            } else {
                query = db.collection('transformed_bank').where('subject', '==', subject).get();
            }

            // DB에서 데이터를 딱 1번만 가져옵니다.
            const snapshot = await query;
            
            // 가져온 데이터를 수첩(cachedBookmarkData)에 모두 적어둡니다.
            cachedBookmarkData = [];
            snapshot.forEach(doc => cachedBookmarkData.push(doc.data()));
            lastBookmarkSubject = subject; // 현재 과목 기억
        }

        // ==========================================================
        // 🚨 이제부터는 DB를 부르지 않고 수첩(cachedBookmarkData)에서 필터링합니다!
        // ==========================================================

        // 🌟 [선생님 로직 1] 선생님 수동 문항 담기 (일반 과목일 때만)
        if (subject !== "uncategorized") {
            const data = subjectData[subject];
            if (data && data.standards) {
                data.standards.forEach(std => {
                    if (std.questions && std.questions.length > 0) {
                        std.questions.forEach(q => {
                            if (q.level === level) {
                                currentBookmarkQuestions.push({
                                    code: std.code, q: q.q, 
                                    imgHtml: "", 
                                    reason: q.reason,
                                    answer: q.answer || "등록된 정답/풀이가 없습니다.",
                                    source: "선생님 등록 문항"
                                });
                            }
                        });
                    }
                });
            }
        }

        // 🌟 [선생님 로직 2] 수첩 데이터 분류해서 담기 (기존 코드 100% 동일)
        cachedBookmarkData.forEach(d => {
            let extractedLevel = d.level || d.original_analysis?.match(/성취수준:\s*([A-E])/)?.[1];
            
            // 미분류 탭 전용 로직
            if (subject === "uncategorized") {
                if (extractedLevel === level && (d.standard_code === "unknown" || d.standard_code === "코드없음")) {
                    const aiSubjectMatch = d.original_analysis?.match(/AI 판단 과목:\s*([^\n]+)/);
                    const displaySubject = aiSubjectMatch ? aiSubjectMatch[1].trim() : d.subject;

                    currentBookmarkQuestions.push({
                        code: `📦 미분류 (${displaySubject})`,
                        q: d.question,
                        reason: d.reason || d.original_analysis?.match(/판정 이유:[\s\S]*?(?=\n\[|$)/)?.[0] || "AI가 미분류 문항으로 판정하였습니다.",
                        answer: d.answer,
                        source: "✨ AI 분석 문항"
                    });
                }
            } 
            // 일반 과목 전용 로직 (이미지 경고문 포함)
            // 일반 과목 전용 로직 (이미지 경고문 포함)
            else {
                // 배열인지 확인하여 조건 검사
                let isUnknown = false;
                let displayCode = "";
                if (Array.isArray(d.standard_code)) {
                    isUnknown = d.standard_code.includes("unknown") || d.standard_code.includes("코드없음");
                    displayCode = d.standard_code.map(c => `[${c}]`).join(', '); // 여러 코드가 예쁘게 출력됨
                } else {
                    isUnknown = d.standard_code === "unknown" || d.standard_code === "코드없음";
                    displayCode = `[${d.standard_code}]`;
                }

                if (extractedLevel === level && !isUnknown) {
                let qImg = d.image || d.imageUrl || d.img;
                
                // 💡 누락되었던 이미지 HTML 생성 로직 추가
                let bookmarkImgHtml = "";
                if (qImg) {
                    bookmarkImgHtml = `<br><img src="${qImg}" style="max-width:100%; margin-top:15px; border-radius:8px; border:1px solid #cbd5e1; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">`;
                }
                
                currentBookmarkQuestions.push({
                    code: displayCode, // 💡 배열로 바뀐 코드를 화면에 출력
                    q: d.question || d.q || "문제 내용이 없습니다.", 
                    imgHtml: bookmarkImgHtml,
                    reason: d.reason || "AI가 원본을 분석하고 변형하며 판정한 문항입니다.",
                    answer: d.answer || "등록된 정답/풀이가 없습니다.", 
                    source: d.source || "✨ AI 추가 문항"
                });
            }
            }
        });
        
        // 🌟 [선생님 로직 3] 정렬 및 화면 그리기
        currentBookmarkQuestions.sort((a, b) => a.code.localeCompare(b.code));
        renderBookmarkList(level); 

    } catch (err) {
        console.error("DB 로드 에러:", err);
        listContainer.innerHTML = "<p style='color:red; text-align:center;'>문항 로딩에 실패했습니다.</p>";
    }
}

function renderBookmarkList(level) {
    const listContainer = document.getElementById('bookmark-list');
    if (currentBookmarkQuestions.length === 0) {
        listContainer.innerHTML = `<p style='text-align:center; color: #64748b; padding: 2rem; background:white; border-radius:8px;'>선택하신 '${level}' 수준에 등록된 문항이 없습니다.</p>`;
        return;
    }

    let html = `<p style="font-weight:bold; color:var(--primary); margin-bottom:10px;">🎉 총 ${currentBookmarkQuestions.length}개의 문항이 검색되었습니다.</p>`;
    
    currentBookmarkQuestions.forEach((item, index) => {
        // 💡 [개선 1] 텍스트 문제 내용 안에 백틱 ```svg ... ``` 코드가 섞여있다면 분리해내기
        // 💡 리스트 요약본에서는 장황한 그림 코드가 찌꺼기까지 완벽히 안 보이게 청소
        let pureText = item.q || "";
        pureText = pureText.replace(/```svg[\s\S]*?```/gi, " [그림 포함] "); // 백틱 덩어리 제거
        pureText = pureText.replace(/<svg[\s\S]*?<\/svg>/gi, " [그림 포함] "); // 생짜 svg 덩어리 제거
        pureText = pureText.replace(/<[^>]*>?/gm, ""); // 뱃지 등 모든 HTML 태그 제거
        pureText = pureText.trim();

        html += `
            <div style="background: white; border: 1px solid var(--border); border-left: 4px solid var(--primary); padding: 1.2rem; border-radius: 8px; cursor: pointer; transition: 0.2s;" 
                 onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'"
                 onclick="openBookmarkModal(${index})">
                <div style="display:flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="font-size: 0.85rem; font-weight: bold; color: #64748b;">${item.code}</span>
                    <span style="font-size: 0.8rem; background: #e2e8f0; padding: 2px 8px; border-radius: 12px; color: #475569;">${item.source}</span>
                </div>
                <div style="font-size: 0.95rem; line-height: 1.5; color: var(--text-main); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
                    ${pureText} </div>
            </div>
        `;
    });
    listContainer.innerHTML = html;

    if (window.MathJax) MathJax.typesetPromise([listContainer]);
}

function openBookmarkModal(index) {
    const item = currentBookmarkQuestions[index];
    document.getElementById('bm-modal-title').innerText = `[${item.code}] 문항 상세`;
    // 💡 문항매칭연습과 동일한 줄바꿈 및 선지 분리 로직 적용!
    let pureText = item.q || "";
    let svgBlocks = [];
    
    // 💡 [모달창 철통 보안] 그림 찢어짐 방지 대피소 로직 적용
    pureText = pureText.replace(/```svg\s*([\s\S]*?)\s*```/gi, (match, innerSvg) => {
        svgBlocks.push(innerSvg.trim());
        return `%%SVG_PLACEHOLDER_${svgBlocks.length - 1}%%`;
    });
    pureText = pureText.replace(/<svg[\s\S]*?<\/svg>/gi, (match) => {
        svgBlocks.push(match);
        return `%%SVG_PLACEHOLDER_${svgBlocks.length - 1}%%`;
    });
    
    let formattedQ = pureText.replace(/\n/g, '<br>');
    formattedQ = formattedQ.replace(/(①|②|③|④|⑤)/g, '<br>&nbsp;&nbsp;$1');
    
    svgBlocks.forEach((svgContent, idx) => {
        let safeSvg = svgContent.replace(/<svg/i, '<svg style="max-width:100%; height:auto; display:block; margin:0 auto;"');
        const svgBoxHtml = `<div class="svg-box" style="margin-top: 15px; text-align: center; background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0; overflow-x: auto;">${safeSvg}</div>`;
        formattedQ = formattedQ.replace(`%%SVG_PLACEHOLDER_${idx}%%`, svgBoxHtml);
    });
    
    if (item.imgHtml) {
        formattedQ += item.imgHtml;
    }
    document.getElementById('bm-modal-q').innerHTML = formattedQ; // 정상 변수 적용
    document.getElementById('bm-modal-reason').innerHTML = item.reason;
    
    const ansDiv = document.getElementById('bm-modal-answer');
    if (item.answer && item.answer !== "등록된 정답/풀이가 없습니다.") {
        // 💡 정답(해설)에도 그림이 있을 수 있으므로 동일하게 보호
        let pureAnsText = item.answer;
        let ansSvgBlocks = [];
        pureAnsText = pureAnsText.replace(/```svg\s*([\s\S]*?)\s*```/gi, (match, innerSvg) => {
            ansSvgBlocks.push(innerSvg.trim()); return `%%SVG_PLACEHOLDER_${ansSvgBlocks.length - 1}%%`;
        });
        pureAnsText = pureAnsText.replace(/<svg[\s\S]*?<\/svg>/gi, (match) => {
            ansSvgBlocks.push(match); return `%%SVG_PLACEHOLDER_${ansSvgBlocks.length - 1}%%`;
        });
        
        let formattedAns = pureAnsText.replace(/\n/g, '<br>');
        ansSvgBlocks.forEach((svgContent, idx) => {
            let safeSvg = svgContent.replace(/<svg/i, '<svg style="max-width:100%; height:auto; display:block; margin:0 auto;"');
            const svgBoxHtml = `<div class="svg-box" style="margin-top: 15px; text-align: center; background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0; overflow-x: auto;">${safeSvg}</div>`;
            formattedAns = formattedAns.replace(`%%SVG_PLACEHOLDER_${idx}%%`, svgBoxHtml);
        });
        
        document.getElementById('bm-modal-answer-text').innerHTML = formattedAns;
        ansDiv.style.display = 'block';
    } else {
        ansDiv.style.display = 'none';
    }
    
    document.getElementById('bookmark-modal').style.display = 'flex';
    if (window.MathJax) MathJax.typesetPromise([document.getElementById('bookmark-modal')]);
}

function closeBookmarkModal() {
    document.getElementById('bookmark-modal').style.display = 'none';
}

// ==========================================
// 📊 분할점수 산출 (AI 마법사) 전용 스크립트 (최신 통합본)
// ==========================================

let cutScoreMode = '';
let parsedScores = [];
let finalExamQuestions = [];
let examImages = [];

const levelMeanings = {
    'A': '성취기준을 포괄적으로 이해하고, 복잡한 문제 상황에서 수학적 개념을 융합하여 해결할 수 있는 수준',
    'B': '성취기준에 대한 이해를 바탕으로, 일반적인 문제 상황에서 수학적 개념을 적용하여 해결할 수 있는 수준',
    'C': '성취기준의 기본적인 개념, 원리, 법칙을 이해하고, 단순한 문제 상황에 적용할 수 있는 수준',
    'D': '성취기준의 기초적인 개념과 원리를 부분적으로 이해하고 있는 수준',
    'E': '성취기준에 대한 이해가 부족하여, 기초적인 수학적 지식에 대한 보충 학습이 필요한 수준'
};

// ------------------------------------------
// [1단계] 평가 세팅 (과목 리스트 동기화 완료)
// ------------------------------------------
function updateSubjectList() {
    const group = document.getElementById('cut-score-group').value;
    const subjectSelect = document.getElementById('cut-score-subject');
    subjectSelect.innerHTML = '<option value="">-- 과목 선택 --</option>';
    
    const subjectsByGroup = {
        'math': [
            {id: 'common1', name: '공통수학1'}, {id: 'common2', name: '공통수학2'},
            {id: 'algebra', name: '대수'}, {id: 'calculus1', name: '미적분Ⅰ'}, {id: 'probStat', name: '확률과 통계'}
        ],
        'korean': [
            {id: 'kor_common1', name: '공통국어1'}, {id: 'kor_common2', name: '공통국어2'},
            {id: 'kor_speech', name: '화법과 언어'}, {id: 'kor_read_write', name: '독서와 작문'}, {id: 'kor_lit', name: '문학'}
        ],
        'english': [
            {id: 'eng_common1', name: '공통영어1'}, {id: 'eng_common2', name: '공통영어2'}, 
            {id: 'eng_1', name: '영어Ⅰ'}, {id: 'eng_2', name: '영어Ⅱ'}, {id: 'eng_read_write', name: '영어 독해와 작문'}
        ],
        'social': [
            {id: 'soc_common1', name: '통합사회1'}, {id: 'soc_common2', name: '통합사회2'}, 
            {id: 'history1', name: '한국사1'}, {id: 'history2', name: '한국사2'}
        ],
        'science': [
            {id: 'sci_common1', name: '통합과학1'}, {id: 'sci_common2', name: '통합과학2'}, 
            {id: 'sci_phy', name: '물리학'}, {id: 'sci_chem', name: '화학'}, {id: 'sci_bio', name: '생명과학'}, {id: 'sci_earth', name: '지구과학'}
        ]
    };

    if (group && subjectsByGroup[group]) {
        subjectsByGroup[group].forEach(sub => {
            const opt = document.createElement('option');
            opt.value = sub.id;
            opt.innerText = sub.name;
            subjectSelect.appendChild(opt);
        });
    }
}

async function loadStandardsForCutScore() {
    const subject = document.getElementById('cut-score-subject').value;
    const listContainer = document.getElementById('cut-score-standards-list');
    if (!subject) return;

    listContainer.innerHTML = '<p style="text-align:center;">성취기준을 불러오는 중... ⏳</p>';

    try {
        const snapshot = await db.collection('standards_2022').where('subject', '==', subject).get();
        let standards = [];
        snapshot.forEach(doc => standards.push({id: doc.id, ...doc.data()}));
        standards.sort((a,b) => a.code.localeCompare(b.code));

        if (standards.length === 0) {
            listContainer.innerHTML = '<p style="text-align:center; color:red;">등록된 데이터가 없습니다.</p>';
            return;
        }

        let html = '';
        standards.forEach((std, index) => {
            html += `<div style="display:flex; align-items:center; padding: 8px; border-bottom: 1px solid #f1f5f9;">
                        <input type="checkbox" class="cut-score-std-cb" value="${std.code}" data-index="${index}" style="margin-right:10px; transform:scale(1.2);">
                        <label style="font-size:0.9rem; cursor:pointer;"><strong>${std.code}</strong> ${std.desc}</label>
                    </div>`;
        });
        listContainer.innerHTML = html;
        initShiftClick();
    } catch (error) {
        listContainer.innerHTML = '<p style="color:red;">데이터 로딩 실패</p>';
    }
}

function initShiftClick() {
    const checkboxes = document.querySelectorAll('.cut-score-std-cb');
    let lastChecked = null;
    checkboxes.forEach(cb => {
        cb.addEventListener('click', function(e) {
            if (!lastChecked) { lastChecked = this; return; }
            if (e.shiftKey) {
                const start = Array.from(checkboxes).indexOf(this);
                const end = Array.from(checkboxes).indexOf(lastChecked);
                checkboxes.forEach((checkbox, i) => {
                    if (i >= Math.min(start, end) && i <= Math.max(start, end)) {
                        checkbox.checked = lastChecked.checked;
                    }
                });
            }
            lastChecked = this;
        });
    });
}


// ==========================================
// 📝 길 1 전용: 엑셀 처리 및 실시간 총점 계산
// ==========================================
function updateStep2Total() {
    let total = 0;
    document.querySelectorAll('.score-input').forEach(inp => {
        total += parseFloat(inp.value) || 0;
    });
    // ✨ [핵심 수정] HTML 태그가 준비되지 않았을 때 코드가 죽지 않도록 방어
    const totalScoreEl = document.getElementById('step2-total-score');
    if (totalScoreEl) {
        totalScoreEl.innerText = total.toFixed(1);
    }
}

// ✨ 기존 데이터를 보존하면서 표 크기만 늘리고 줄이는 스마트 표 생성 함수
async function generateEmptyScoreTable() {
    const choiceCount = parseInt(document.getElementById('choice-count').value) || 0;
    const shortCount = parseInt(document.getElementById('short-count').value) || 0;
    
    try {
        const docRef = db.collection('user_projects').doc(currentProjectId);
        const doc = await docRef.get();
        if(doc.exists) {
            let assessments = doc.data().assessments;
            let existingScores = assessments[currentEditingAssessmentIndex].parsedScores || [];
            let newScores = [];
            
            if (existingScores.length > 0) {
                // 이미 데이터가 있을 때 유지 여부를 물어봅니다.
                const isKeep = confirm("기존에 입력된 문항 데이터가 있습니다. 데이터를 유지하시겠습니까?\n\n[확인] 입력된 데이터 유지 (개수만 조절)\n[취소] 기존 데이터를 모두 삭제하고 초기화");
                
                if (isKeep) {
                    let existingChoices = existingScores.filter(q => !(q.isShortAnswer || String(q.num).includes('서')));
                    let existingShorts = existingScores.filter(q => q.isShortAnswer || String(q.num).includes('서'));
                    
                    // 객관식 조절 (넘치면 유지, 모자라면 새 빈칸 추가)
                    for(let i=0; i<choiceCount; i++) {
                        if (i < existingChoices.length) newScores.push(existingChoices[i]);
                        else newScores.push({ num: String(i+1), difficulty: '선택하세요', score: 0, level: '판정필요', isShortAnswer: false });
                    }
                    
                    // 서답형 조절 (넘치면 유지, 모자라면 새 빈칸 추가)
                    for(let i=0; i<shortCount; i++) {
                        if (i < existingShorts.length) {
                            let sq = existingShorts[i];
                            sq.num = '서' + (i+1); // 번호 자동 정렬
                            newScores.push(sq);
                        }
                        else newScores.push({ num: '서'+(i+1), difficulty: '선택하세요', score: 0, level: '판정필요', isShortAnswer: true });
                    }
                } else {
                    // 취소를 누르면 묻지도 따지지도 않고 완전 초기화
                    for(let i=1; i<=choiceCount; i++) newScores.push({ num: String(i), difficulty: '선택하세요', score: 0, level: '판정필요', isShortAnswer: false });
                    for(let i=1; i<=shortCount; i++) newScores.push({ num: '서'+i, difficulty: '선택하세요', score: 0, level: '판정필요', isShortAnswer: true });
                }
            } else {
                // 기존 데이터가 아예 없을 때는 그냥 바로 생성
                for(let i=1; i<=choiceCount; i++) newScores.push({ num: String(i), difficulty: '선택하세요', score: 0, level: '판정필요', isShortAnswer: false });
                for(let i=1; i<=shortCount; i++) newScores.push({ num: '서'+i, difficulty: '선택하세요', score: 0, level: '판정필요', isShortAnswer: true });
            }

            assessments[currentEditingAssessmentIndex].parsedScores = newScores;
            await docRef.update({ assessments: assessments });
        }
    } catch(e) { alert("표 생성 실패: " + e.message); }
}


async function downloadScoreTemplate() {
    if (!currentProjectId || currentEditingAssessmentIndex < 0) {
        alert("선택된 평가가 없습니다.");
        return;
    }

    try {
        const docRef = db.collection('user_projects').doc(currentProjectId);
        const doc = await docRef.get();
        
        if (doc.exists) {
            let asm = doc.data().assessments[currentEditingAssessmentIndex];
            let existingScores = asm.parsedScores || [];
            
            // 💡 로그인한 선생님(나)의 기존 판정 데이터만 데이터베이스에서 직접 빼옵니다.
            let myInputs = [];
            if (asm.teacherInputs && asm.teacherInputs[auth.currentUser.email]) {
                myInputs = asm.teacherInputs[auth.currentUser.email];
            }

            // 엑셀 첫 번째 줄(헤더) 만들기
            let excelData = [["문항 번호", "예상 난이도", "배점", "성취수준"]];

            // 엑셀에 들어갈 데이터 채우기
            existingScores.forEach((q, index) => {
                // 내 판정 결과가 있으면 가져오고, 없으면 빈칸으로 둡니다. (AI나 다른 사람 것은 안 가져옵니다!)
                let myLevel = myInputs[index] ? myInputs[index].level : "";
                
                excelData.push([
                    q.num,
                    q.difficulty || "", // 공통 데이터인 난이도는 표시
                    q.score || 0,       // 공통 데이터인 배점은 표시
                    myLevel             // 오직 '내 판정' 결과만 표시
                ]);
            });

            // 엑셀 파일 생성 및 다운로드 실행 (한글 깨짐이 없는 진짜 엑셀 XLSX 포맷)
            const ws = XLSX.utils.aoa_to_sheet(excelData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "평가양식");
            
            // 파일명에 평가 이름이 자동으로 들어가도록 설정
            XLSX.writeFile(wb, `${asm.name}_내입력양식.xlsx`);
        }
    } catch (error) {
        alert("엑셀 다운로드 중 오류가 발생했습니다: " + error.message);
    }
}

async function handleExcelUpload(event) {
    const file = event.target.files[0];
    if(!file) return;
    const reader = new FileReader();

    reader.onload = async function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, {header: 1});

            if (currentProjectId) {
                const docRef = db.collection('user_projects').doc(currentProjectId);
                const doc = await docRef.get();
                if(doc.exists) {
                    let assessments = doc.data().assessments;
                    let asm = assessments[currentEditingAssessmentIndex];
                    
                    // 💡 기존 DB 데이터를 불러옵니다. (AI 판정 결과를 지켜주기 위해!)
                    let existingScores = asm.parsedScores || [];
                    let myLevels = [];
                    let newScores = [];

                    jsonData.forEach((row, index) => {
                        if (index === 0 || !row || row.length === 0) return;
                        if (row[0] !== undefined && row[0] !== null && String(row[0]).trim() !== "") {
                            let qNum = String(row[0]).trim();
                            
                            // 현재 올리는 엑셀 문항과 똑같은 번호의 기존 DB 문항 찾기
                            let existQ = existingScores.find(q => String(q.num) === qNum) || {};

                            // 1. 난이도: 엑셀이 절대적 기준! (선생님이 엑셀에서 적은 대로, 지웠으면 지운 대로)
                            let diff = (row[1] || '').toString().trim();
                            if(diff === '선택안함' || !['상','중','하'].includes(diff)) diff = ''; 

                            // 2. 배점: 엑셀이 절대적 기준! (선생님이 적은 숫자 그대로)
                            let score = parseFloat(row[2]);
                            if (isNaN(score) || score < 0) score = 0;

                            // 3. 성취수준 (내 판정): 선생님이 엑셀 마지막 칸에 채워 넣은 A, B, C...
                            let level = (row[3] || '').toString().toUpperCase().trim();
                            if(level === '선택안함' || !['A+','A','B','C','D','E'].includes(level)) level = ''; 

                            // 4. 표 데이터 조립 (엑셀에 없는 AI 판정 결과만 기존 DB에서 가져와 보호합니다!)
                            newScores.push({ 
                                num: qNum, 
                                difficulty: diff, 
                                score: score, 
                                level: existQ.level || '판정필요', // 🛡️ AI 판정 결과 완벽 보호
                                isShortAnswer: existQ.isShortAnswer !== undefined ? existQ.isShortAnswer : qNum.includes('서') 
                            });
                            
                            // 선생님의 성취수준 입력값은 내 판정 전용 공간에 따로 저장
                            myLevels.push({ level: level });
                        }
                    });

                    // DB에 최종 업데이트
                    asm.parsedScores = newScores;
                    if (!asm.teacherInputs) asm.teacherInputs = {};
                    asm.teacherInputs[auth.currentUser.email] = myLevels;

                    await docRef.update({ assessments: assessments });
                    alert("✅ 엑셀 데이터가 완벽하게 동기화되었습니다!\n(선생님의 작업 내역 반영 & AI 판정 결과 보호 완료)");
                }
            }
            document.getElementById('excel-upload').value = ""; 
        } catch(error) { 
            alert("엑셀 업로드 실패: " + error.message); 
        }
    };
    reader.readAsArrayBuffer(file);
}

function getBasePct(isShortAnswer, difficulty) {
    if (!isShortAnswer) { 
        // 🟢 선택형 (객관식)
        if (difficulty === '하' || difficulty === '쉬움') return { A: 95, B: 85, C: 75, D: 60, E: 45 };
        if (difficulty === '상' || difficulty === '어려움') return { A: 75, B: 60, C: 45, D: 30, E: 15 };
        // 중 (보통)
        return { A: 80, B: 70, C: 55, D: 45, E: 35 };
    } else { 
        // 🔴 서답형
        if (difficulty === '하' || difficulty === '쉬움') return { A: 90, B: 80, C: 65, D: 50, E: 35 };
        if (difficulty === '상' || difficulty === '어려움') return { A: 60, B: 45, C: 30, D: 20, E: 10 };
        // 중 (보통) - 서답형 중간값 추정 (선택형 중보다 약간 낮게)
        return { A: 70, B: 55, C: 40, D: 30, E: 20 };
    }
}

// 💡 [수정 완료] 다른 교사의 평균을 내지 않고, '오직 나의 판정'만으로 M자 표를 생성하도록 변경됨
async function handleNextToPath1Result() {
    if (!currentProjectId) return;

    try {
        const docRef = db.collection('user_projects').doc(currentProjectId);
        const doc = await docRef.get();
        if(!doc.exists) return;

        const projectData = doc.data();
        const asm = projectData.assessments[currentEditingAssessmentIndex];
        const teacherInputs = asm.teacherInputs || {};
        let baseQuestions = asm.parsedScores || [];
        const myEmail = auth.currentUser.email;

        const myStatus = asm.readyStatus ? asm.readyStatus[myEmail] : '대기 중';
        if (myStatus !== '완료') {
            alert("🔒 아직 '내 판정 저장 완료'가 되지 않았습니다.\n먼저 표 아래의 [내 판정 최종 저장하기] 버튼을 눌러주세요!");
            return;
        }

        const myInputs = teacherInputs[myEmail] || [];
        let myMergedData = baseQuestions.map((q, qIdx) => {
            let myLevel = myInputs[qIdx]?.level; 
            return {
                num: q.num, score: q.score, difficulty: q.difficulty || '중',
                level: myLevel || q.level || 'C', isShortAnswer: q.isShortAnswer, pcts: getBasePct(q.isShortAnswer, q.difficulty || '중')
            };
        });

        parsedScores = myMergedData; 
        history.pushState({ section: 'cut-score', sub: 'step4' }, "", "#cut-score/step4");
        
        goToStep(4);
        renderGroupedCutScoreTable(myMergedData);

        const saveBtn = document.getElementById('btn-save-m'); 

        // 🛡️ [데이터 보존 1] 선생님이 만드신 입력창 잠금 및 저장 버튼 상태 유지 로직 (원형 100% 보존)
        if (asm.teacherCutScores && asm.teacherCutScores[myEmail]) {
            if (saveBtn) {
                saveBtn.innerHTML = "✅ 저장 완료"; // 👈 저장완료로 다시 바꿈
                saveBtn.style.background = "#10b981"; 
                saveBtn.disabled = true;
                saveBtn.style.cursor = "not-allowed";
            }
            document.querySelectorAll('.pct-input').forEach(input => {
                input.disabled = true;
                input.style.background = "#f1f5f9";
            });
        } else {
            if (saveBtn) {
                saveBtn.innerHTML = "💾 결과 저장하기";
                saveBtn.style.background = "#ef4444"; 
                saveBtn.disabled = false;
                saveBtn.style.cursor = "pointer";
            }
            document.querySelectorAll('.pct-input').forEach(input => {
                input.disabled = false;
                input.style.background = "white";
            });
        }

        // 🛡️ [데이터 보존 2] 선생님이 만드신 M자 테이블 빈칸 유지 기술 (원형 100% 보존)
        if (asm.teacherMTable && asm.teacherMTable[myEmail]) {
            const myMTable = asm.teacherMTable[myEmail];
            const rows = document.querySelectorAll('#cut-score-result-table .cut-score-row');
            rows.forEach((row, idx) => {
                if (myMTable[idx]) {
                    row.querySelector('.pct-A').value = myMTable[idx].A;
                    row.querySelector('.pct-B').value = myMTable[idx].B;
                    row.querySelector('.pct-C').value = myMTable[idx].C;
                    row.querySelector('.pct-D').value = myMTable[idx].D;
                    row.querySelector('.pct-E').value = myMTable[idx].E;
                }
            });
            calculateTotalCutScores(); 
        }

        // 🚀 [다이어트 성공!] 길고 복잡했던 상태창 HTML 그리기 코드를 단 3줄로 완벽 압축
        // (선생님의 원래 기획대로 모두 완료 시에만 '비교하기'가 활성화 되도록 내부적으로 처리됩니다)
        if (typeof updateMTableStatus === 'function') {
            updateMTableStatus(asm, projectData);
        }

    } catch (e) {
        alert("최종 산출 중 오류가 발생했습니다: " + e.message);
    }
}



function renderGroupedCutScoreTable(mergedData) {
    document.getElementById('final-result-container').style.display = 'block';
    document.getElementById('final-ai-loading').style.display = 'none';
    
    const tableHead = document.querySelector('#cut-score-result-table').previousElementSibling;
    if (tableHead) {
        tableHead.innerHTML = `<tr><th style="min-width:180px;">문항 범주 (M자형)</th><th>총 배점</th><th>예상 난이도</th><th>A (%)</th><th>B (%)</th><th>C (%)</th><th>D (%)</th><th>E (%)</th></tr>`;
        tableHead.parentElement.style.display = 'block'; 
    }

    const tbody = document.getElementById('cut-score-result-table');
    
    // 💡 A+ 그룹 방을 추가로 만들어 둡니다.
    const groups = {
        '선택형(객관식)_상': { typeStr: '선택형(객관식)', difficulty: '상', count: 0, scoreSum: 0, levels: {'A+':[], 'A':[], 'B':[], 'C':[], 'D':[], 'E':[]}, pcts: getBasePct(false, '상') },
        '선택형(객관식)_중': { typeStr: '선택형(객관식)', difficulty: '중', count: 0, scoreSum: 0, levels: {'A+':[], 'A':[], 'B':[], 'C':[], 'D':[], 'E':[]}, pcts: getBasePct(false, '중') },
        '선택형(객관식)_하': { typeStr: '선택형(객관식)', difficulty: '하', count: 0, scoreSum: 0, levels: {'A+':[], 'A':[], 'B':[], 'C':[], 'D':[], 'E':[]}, pcts: getBasePct(false, '하') },
        '서답형_상': { typeStr: '서답형', difficulty: '상', count: 0, scoreSum: 0, levels: {'A+':[], 'A':[], 'B':[], 'C':[], 'D':[], 'E':[]}, pcts: getBasePct(true, '상') },
        '서답형_중': { typeStr: '서답형', difficulty: '중', count: 0, scoreSum: 0, levels: {'A+':[], 'A':[], 'B':[], 'C':[], 'D':[], 'E':[]}, pcts: getBasePct(true, '중') },
        '서답형_하': { typeStr: '서답형', difficulty: '하', count: 0, scoreSum: 0, levels: {'A+':[], 'A':[], 'B':[], 'C':[], 'D':[], 'E':[]}, pcts: getBasePct(true, '하') }
    };
    
    mergedData.forEach(q => {
        const typeStr = q.isShortAnswer ? '서답형' : '선택형(객관식)';
        let diff = q.difficulty;
        if (diff === '쉬움') diff = '하';
        if (diff === '보통') diff = '중';
        if (diff === '어려움') diff = '상';

        const key = `${typeStr}_${diff}`;
        if (groups[key]) {
            groups[key].count++;
            groups[key].scoreSum += q.score;
            
            if (groups[key].levels[q.level]) {
                groups[key].levels[q.level].push(q.num);
            } else {
                groups[key].levels['C'].push(q.num); 
            }
        }
    });

    // 노란색 하이라이트 매핑 (A+도 A와 동일한 컷오프 칸에 하이라이트 되도록 처리)
    const highlightMap = {
        0: ['A+', 'A', 'E'],      
        1: ['C'],           
        2: ['A+', 'A', 'E'], 
        3: ['A+', 'A', 'E'],      
        4: ['C'],           
        5: ['A+', 'A', 'E']       
    };

    let html = '';
    
    Object.values(groups).forEach((g, index) => {
        const isEmpty = g.count === 0;
        let bottomBorder = (index === 2) ? 'border-bottom: 3px double #64748b;' : 'border-bottom: 1px solid #e2e8f0;';
        const rowStyle = isEmpty ? `background: #f8fafc; opacity: 0.5; ${bottomBorder}` : bottomBorder;
        const diffColor = isEmpty ? '#cbd5e1' : (g.difficulty === '상' ? '#ef4444' : g.difficulty === '중' ? '#f59e0b' : '#22c55e');
        const countText = isEmpty ? '0문항' : `총 ${g.count}문항`;
        const scoreText = isEmpty ? '-' : g.scoreSum.toFixed(1);
        
        let qNumHtml = '';
        if (isEmpty) {
            qNumHtml = '<div style="color:#94a3b8; font-size:0.8rem; margin-bottom:4px;">해당 문항 없음</div>';
        } else {
            // 💡 A+ 도 찾아서 출력! (A+는 빨간 글씨로 돋보이게 처리합니다)
            ['A+', 'A', 'B', 'C', 'D', 'E'].forEach(lvl => {
                if (g.levels[lvl].length > 0) {
                    let lvlLabel = lvl === 'A+' ? '<strong style="color:#ef4444;">A+</strong>' : `<strong>${lvl}</strong>`;
                    qNumHtml += `<div style="font-size:0.85rem; color:#475569; margin-bottom:2px;">${lvlLabel}: ${g.levels[lvl].join(', ')}번</div>`;
                }
            });
        }

        const getPctInput = (lvl, val) => {
            const disabledAttr = isEmpty ? 'disabled' : '';
            let bgStyle = isEmpty ? 'background: #e2e8f0;' : 'background: white;';
            let borderStyle = 'border: 1px solid #cbd5e1;';
            
            if (!isEmpty && highlightMap[index].includes(lvl)) {
                bgStyle = 'background: #fef08a;'; 
                borderStyle = 'border: 2px solid #eab308;'; 
            }
            
            return `<input type="number" class="pct-${lvl} pct-input" value="" ${disabledAttr} oninput="markAsModified(this); calculateTotalCutScores()" style="width: 60px; padding: 4px; text-align: center; border-radius: 4px; font-weight: bold; color: #1e293b; ${bgStyle} ${borderStyle} transition: 0.2s;">`;
        };  

        html += `
        <tr style="${rowStyle}" class="cut-score-row" data-score="${g.scoreSum}" data-count="1">
            <td style="text-align: left; vertical-align: top;">
                ${qNumHtml}
                <strong style="color: ${isEmpty ? '#94a3b8' : 'var(--primary)'}; display:block; margin-top:5px;">${g.typeStr} ${countText}</strong>
            </td>
            <td style="color: ${isEmpty ? '#94a3b8' : '#ea580c'}; font-weight: bold; font-size: 1.1rem; vertical-align: middle;">${scoreText}</td>
            <td style="vertical-align: middle;">
                <span style="background:${diffColor}; color:white; padding: 4px 10px; border-radius: 4px; font-weight: bold;">${g.difficulty}</span>
            </td>
            <td style="vertical-align: middle;">${getPctInput('A', g.pcts.A)}</td>
            <td style="vertical-align: middle;">${getPctInput('B', g.pcts.B)}</td>
            <td style="vertical-align: middle;">${getPctInput('C', g.pcts.C)}</td>
            <td style="vertical-align: middle;">${getPctInput('D', g.pcts.D)}</td>
            <td style="vertical-align: middle;">${getPctInput('E', g.pcts.E)}</td>
        </tr>
        `;
    });

    tbody.innerHTML = html;
    calculateTotalCutScores();
    showModificationNotice();
}

function calculateTotalCutScores() {
    let totalA = 0, totalB = 0, totalC = 0, totalD = 0, totalE = 0;
    let totalScore = 0;

    document.querySelectorAll('.cut-score-row').forEach(row => {
        const score = parseFloat(row.getAttribute('data-score')) || 0;
        const count = parseInt(row.getAttribute('data-count')) || 1;
        const groupTotalPoints = score * count; 
        totalScore += groupTotalPoints;
        
        const pctA = (parseFloat(row.querySelector('.pct-A').value) || 0) / 100;
        const pctB = (parseFloat(row.querySelector('.pct-B').value) || 0) / 100;
        const pctC = (parseFloat(row.querySelector('.pct-C').value) || 0) / 100;
        const pctD = (parseFloat(row.querySelector('.pct-D').value) || 0) / 100;
        const pctE = (parseFloat(row.querySelector('.pct-E').value) || 0) / 100;

        totalA += groupTotalPoints * pctA;
        totalB += groupTotalPoints * pctB;
        totalC += groupTotalPoints * pctC;
        totalD += groupTotalPoints * pctD;
        totalE += groupTotalPoints * pctE;
    });

    renderFinalScoreBoxes(totalA, totalB, totalC, totalD, totalE, totalScore);
}

function renderFinalScoreBoxes(A, B, C, D, E, totalScore) {
    document.getElementById('final-cut-score-boxes').style.flexWrap = 'wrap';

    const boxHtml = `
        <div style="width: 100%; text-align: center; margin-bottom: 10px; color: #64748b; font-weight: bold;">(최종 인식된 총 배점: ${totalScore.toFixed(1)}점)</div>
        
        <div style="flex:1; min-width:110px; padding:10px 5px; background:#fef2f2; border: 2px solid #ef4444; border-radius:8px; white-space: nowrap; text-align: center;">
            <strong style="font-size:0.9rem;">A수준 컷오프</strong><br>
            <span style="font-size:1.25rem; font-weight:bold; color:#ef4444;">${A.toFixed(2)}점</span>
        </div>
        
        <div style="flex:1; min-width:110px; padding:10px 5px; background:#fffbeb; border: 2px solid #f59e0b; border-radius:8px; white-space: nowrap; text-align: center;">
            <strong style="font-size:0.9rem;">B수준 컷오프</strong><br>
            <span style="font-size:1.25rem; font-weight:bold; color:#f59e0b;">${B.toFixed(2)}점</span>
        </div>
        
        <div style="flex:1; min-width:110px; padding:10px 5px; background:#f0fdf4; border: 2px solid #22c55e; border-radius:8px; white-space: nowrap; text-align: center;">
            <strong style="font-size:0.9rem;">C수준 컷오프</strong><br>
            <span style="font-size:1.25rem; font-weight:bold; color:#22c55e;">${C.toFixed(2)}점</span>
        </div>
        
        <div style="flex:1; min-width:110px; padding:10px 5px; background:#eff6ff; border: 2px solid #3b82f6; border-radius:8px; white-space: nowrap; text-align: center;">
            <strong style="font-size:0.9rem;">D수준 컷오프</strong><br>
            <span style="font-size:1.25rem; font-weight:bold; color:#3b82f6;">${D.toFixed(2)}점</span>
        </div>
        
        <div style="flex:1; min-width:110px; padding:10px 5px; background:#f8fafc; border: 2px solid #94a3b8; border-radius:8px; white-space: nowrap; text-align: center;">
            <strong style="font-size:0.9rem;">E수준 컷오프</strong><br>
            <span style="font-size:1.25rem; font-weight:bold; color:#64748b;">${E.toFixed(2)}점</span>
        </div>
    `;
    document.getElementById('final-cut-score-boxes').innerHTML = boxHtml;
    document.getElementById('final-result-container').style.display = 'block';

    const aiLoading = document.getElementById('final-ai-loading');
    if(aiLoading) aiLoading.style.display = 'none';
}


// 💡 [추가] 사용자가 값을 수정했을 때 빗금 패턴을 입혀주는 함수
function markAsModified(element) {
    // 빨간색(투명도 15%)의 사선 빗금 패턴을 배경 위에 덧씌우고 테두리를 강조합니다.
    element.style.backgroundImage = 'repeating-linear-gradient(-45deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.15) 5px, transparent 5px, transparent 10px)';
    element.style.borderColor = '#ef4444';
    element.style.borderWidth = '2px';
}
// 💡 [추가] 표 위에 빗금 수정 기능 안내 배너를 띄워주는 함수
function showModificationNotice() {
    const table = document.getElementById('cut-score-result-table').parentElement; // 테이블 태그 찾기
    
    // 이미 안내문이 있으면 중복 생성 방지
    if (!document.getElementById('mod-notice-banner')) {
        const notice = document.createElement('div');
        notice.id = 'mod-notice-banner';
        notice.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.2rem;">💡</span>
                <div>
                    <strong style="color: #1e3a8a;">[수정 알림 기능]</strong> 
                    표 안의 비율(%) 숫자를 선생님 재량으로 수정하시면, 해당 칸에 <span style="background: repeating-linear-gradient(-45deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.15) 5px, transparent 5px, transparent 10px); border: 2px solid #ef4444; padding: 2px 6px; border-radius: 4px; font-weight: bold; color: #ef4444;">붉은 빗금</span>이 표시되어 수정 여부를 쉽게 확인할 수 있습니다.
                </div>
            </div>
        `;
        notice.style.cssText = "background: #eff6ff; border: 1px solid #bfdbfe; padding: 12px 16px; border-radius: 8px; font-size: 0.9rem; margin-bottom: 15px; border-left: 4px solid #3b82f6; text-align: left; line-height: 1.5;";
        
        // 테이블 바로 위에 배너 삽입
        table.parentNode.insertBefore(notice, table);
    }
}

// 🌟 길 1, 2 공통: 뒤로 가기 흐름 제어 함수 (수정됨)
function goBackStep(currentStep) {
    if (currentStep === 4) {
        // 4단계(최종 결과)에서 뒤로 가면 2단계(표 작성/AI 도우미 화면)로 돌아갑니다.
        goToStep(2); 
    }
}

// 📊 비교하기 모달을 열고 데이터를 렌더링하는 함수
async function openCompareModal() {
    if (!currentProjectId || currentEditingAssessmentIndex === -1) return;
    
    try {
        const docRef = db.collection('user_projects').doc(currentProjectId);
        const doc = await docRef.get();
        if (!doc.exists) return;
        
        const projectData = doc.data();
        const asm = projectData.assessments[currentEditingAssessmentIndex];
        const baseQuestions = asm.parsedScores || [];
        const teacherInputs = asm.teacherInputs || {};
        
        let allMembers = projectData.collaborators || [];
        if (projectData.ownerEmail && !allMembers.includes(projectData.ownerEmail)) allMembers.unshift(projectData.ownerEmail); 
        const currentUserEmail = auth.currentUser.email;
        if (!allMembers.includes(currentUserEmail)) allMembers.push(currentUserEmail); 
        const collaborators = [...new Set(allMembers)];
        
        const container = document.getElementById('compare-modal-content');
        
        // 💡 [핵심] 비교창 내부를 2열 Grid 구조로 변경합니다!
        container.style.display = 'grid';
        container.style.gridTemplateColumns = 'repeat(auto-fit, minmax(450px, 1fr))';
        container.style.gap = '1.5rem';
        
        let html = '';
        
        collaborators.forEach(email => {
            const inputs = teacherInputs[email] || [];
            const cutScores = asm.teacherCutScores ? asm.teacherCutScores[email] : null;
            const mTablePcts = asm.teacherMTable ? asm.teacherMTable[email] : null; 
            const name = email.split('@')[0];
            
            if (!cutScores) {
                html += `
                <div style="border: 2px dashed #cbd5e1; border-radius: 8px; padding: 1.5rem; background: #f8fafc; text-align: center; height: 100%; display: flex; align-items: center; justify-content: center;">
                    <h3 style="margin: 0; color: #94a3b8;">👤 ${name} 선생님<br><span style="font-size:0.9rem; font-weight:normal;">(아직 저장을 완료하지 않았습니다)</span></h3>
                </div>`;
                return;
            }
            
            const groups = {
                '선택형(객관식)_상': { typeStr: '객관식', difficulty: '상', count: 0, scoreSum: 0, levels: {'A+':[], 'A':[], 'B':[], 'C':[], 'D':[], 'E':[]}, pcts: getBasePct(false, '상') },
                '선택형(객관식)_중': { typeStr: '객관식', difficulty: '중', count: 0, scoreSum: 0, levels: {'A+':[], 'A':[], 'B':[], 'C':[], 'D':[], 'E':[]}, pcts: getBasePct(false, '중') },
                '선택형(객관식)_하': { typeStr: '객관식', difficulty: '하', count: 0, scoreSum: 0, levels: {'A+':[], 'A':[], 'B':[], 'C':[], 'D':[], 'E':[]}, pcts: getBasePct(false, '하') },
                '서답형_상': { typeStr: '서답형', difficulty: '상', count: 0, scoreSum: 0, levels: {'A+':[], 'A':[], 'B':[], 'C':[], 'D':[], 'E':[]}, pcts: getBasePct(true, '상') },
                '서답형_중': { typeStr: '서답형', difficulty: '중', count: 0, scoreSum: 0, levels: {'A+':[], 'A':[], 'B':[], 'C':[], 'D':[], 'E':[]}, pcts: getBasePct(true, '중') },
                '서답형_하': { typeStr: '서답형', difficulty: '하', count: 0, scoreSum: 0, levels: {'A+':[], 'A':[], 'B':[], 'C':[], 'D':[], 'E':[]}, pcts: getBasePct(true, '하') }
            };
            
            baseQuestions.forEach((q, qIdx) => {
                const typeStr = q.isShortAnswer ? '서답형' : '선택형(객관식)';
                let diff = q.difficulty;
                if (diff === '쉬움') diff = '하'; if (diff === '보통') diff = '중'; if (diff === '어려움') diff = '상';
                
                let myLevel = inputs[qIdx]?.level || 'C'; 
                
                const key = `${typeStr}_${diff}`;
                if (groups[key]) {
                    groups[key].count++;
                    groups[key].scoreSum += q.score;
                    if (groups[key].levels[myLevel]) groups[key].levels[myLevel].push(q.num);
                    else groups[key].levels['C'].push(q.num); 
                }
            });
            
            html += `
            <div style="border: 2px solid #cbd5e1; border-radius: 8px; padding: 1rem; background: white; box-shadow: 0 4px 6px rgba(0,0,0,0.05); display: flex; flex-direction: column;">
                <h3 style="margin: 0 0 10px 0; color: #1e3a8a; font-size: 1.1rem; border-bottom: 2px solid #8b5cf6; padding-bottom: 8px;">👤 ${name} 선생님의 판정</h3>
                
                <div style="flex: 1; overflow-x: auto;">
                    <table class="score-table" style="width: 100%; margin-bottom: 10px; font-size: 0.85rem;">
                        <thead style="background: #f1f5f9;">
                            <tr><th style="min-width:100px;">범주</th><th style="width:40px;">배점</th><th>난이도</th><th>A (%)</th><th>B (%)</th><th>C (%)</th><th>D (%)</th><th>E (%)</th></tr>
                        </thead>
                        <tbody>`;
            
            Object.values(groups).forEach((g, index) => {
                const isEmpty = g.count === 0;
                let bottomBorder = (index === 2) ? 'border-bottom: 3px double #64748b;' : 'border-bottom: 1px solid #e2e8f0;';
                const rowStyle = isEmpty ? `background: #f8fafc; opacity: 0.5; ${bottomBorder}` : bottomBorder;
                const diffColor = isEmpty ? '#cbd5e1' : (g.difficulty === '상' ? '#ef4444' : g.difficulty === '중' ? '#f59e0b' : '#22c55e');
                
                let qNumHtml = '';
                if (isEmpty) {
                    qNumHtml = '<div style="color:#94a3b8; font-size:0.75rem;">문항 없음</div>';
                } else {
                    ['A+', 'A', 'B', 'C', 'D', 'E'].forEach(lvl => {
                        if (g.levels[lvl].length > 0) {
                            let lvlLabel = lvl === 'A+' ? '<strong style="color:#ef4444;">A+</strong>' : `<strong>${lvl}</strong>`;
                            qNumHtml += `<div style="font-size:0.8rem; color:#475569; margin-bottom:2px;">${lvlLabel}: ${g.levels[lvl].join(', ')}</div>`;
                        }
                    });
                }
                
                let pcts = mTablePcts && mTablePcts[index] ? mTablePcts[index] : g.pcts;
                const getPctInput = (val) => `<input type="number" value="${isEmpty ? '' : val}" disabled style="width: 35px; padding: 2px; text-align: center; border-radius: 4px; border: 1px solid #cbd5e1; background: #f1f5f9; font-weight: bold; color: #475569; font-size: 0.8rem;">`;

                html += `
                <tr style="${rowStyle}">
                    <td style="text-align: left; vertical-align: top; padding: 6px;">
                        ${qNumHtml}
                        <strong style="color: ${isEmpty ? '#94a3b8' : 'var(--primary)'}; display:block; margin-top:3px; font-size:0.8rem;">${g.typeStr}(${g.count})</strong>
                    </td>
                    <td style="color: ${isEmpty ? '#94a3b8' : '#ea580c'}; font-weight: bold; vertical-align: middle; padding: 6px;">${isEmpty ? '-' : g.scoreSum.toFixed(1)}</td>
                    <td style="vertical-align: middle; padding: 6px;"><span style="background:${diffColor}; color:white; padding: 3px 6px; border-radius: 4px; font-weight: bold; font-size: 0.8rem;">${g.difficulty}</span></td>
                    <td style="vertical-align: middle; padding: 6px;">${getPctInput(pcts.A)}</td>
                    <td style="vertical-align: middle; padding: 6px;">${getPctInput(pcts.B)}</td>
                    <td style="vertical-align: middle; padding: 6px;">${getPctInput(pcts.C)}</td>
                    <td style="vertical-align: middle; padding: 6px;">${getPctInput(pcts.D)}</td>
                    <td style="vertical-align: middle; padding: 6px;">${getPctInput(pcts.E)}</td>
                </tr>`;
            });
            
            html += `</tbody></table></div>
                <div style="display: flex; gap: 4px; justify-content: space-between; margin-top: auto;">
                    <span style="flex:1; text-align:center; background:#fef2f2; border: 1px solid #ef4444; color:#ef4444; padding: 4px; border-radius: 4px; font-size: 0.8rem; font-weight: bold;">A<br>${cutScores.A.toFixed(1)}</span>
                    <span style="flex:1; text-align:center; background:#fffbeb; border: 1px solid #f59e0b; color:#f59e0b; padding: 4px; border-radius: 4px; font-size: 0.8rem; font-weight: bold;">B<br>${cutScores.B.toFixed(1)}</span>
                    <span style="flex:1; text-align:center; background:#f0fdf4; border: 1px solid #22c55e; color:#22c55e; padding: 4px; border-radius: 4px; font-size: 0.8rem; font-weight: bold;">C<br>${cutScores.C.toFixed(1)}</span>
                    <span style="flex:1; text-align:center; background:#eff6ff; border: 1px solid #3b82f6; color:#3b82f6; padding: 4px; border-radius: 4px; font-size: 0.8rem; font-weight: bold;">D<br>${cutScores.D.toFixed(1)}</span>
                    <span style="flex:1; text-align:center; background:#f8fafc; border: 1px solid #64748b; color:#64748b; padding: 4px; border-radius: 4px; font-size: 0.8rem; font-weight: bold;">E<br>${cutScores.E.toFixed(1)}</span>
                </div>
            </div>`;
        });
        
        container.innerHTML = html;
        document.getElementById('compare-modal').style.display = 'flex';
        
    } catch (e) {
        alert("비교 데이터를 불러오는 중 오류가 발생했습니다: " + e.message);
    }
}

// 전역 변수로 관리하여 삭제/수정이 용이하게 합니다
let extractedQuestionsArray = [];

function renderQuestionCards() {
    const listContainer = document.getElementById('extracted-questions-list');
    listContainer.innerHTML = `
        <div style="background: #fff1f2; border-left: 4px solid #f43f5e; padding: 12px 16px; margin-bottom: 20px; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <div style="display: flex; align-items: center; gap: 8px; color: #be123c; font-weight: bold; margin-bottom: 4px;">
                <svg width="20" height="20" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path></svg>
                [AI 판정 유의사항] 인간(교사)의 최종 검토가 필수입니다!
            </div>
            <div style="font-size: 0.85rem; color: #881337; line-height: 1.5; padding-left: 28px;">
                AI는 복합 개념을 오해하여 엉뚱한 성취기준을 잡거나 난이도를 착각(할루시네이션)할 수 있습니다. 반드시 <b>'판정 이유'</b>를 읽어보시고, 이상하다면 즉시 기준과 수준을 교사가 직접 수정해 주세요.
            </div>
        </div>
    `;
    
    extractedQuestionsArray.forEach((q, idx) => {
        const qCard = document.createElement('div');
        qCard.className = "quiz-container";
        qCard.style.marginBottom = "1rem";
        qCard.style.borderLeft = "4px solid #ea580c";
        
        let passageUI = "";
        if (q.passageRange && q.passageContent) {
            passageUI = `
                <details style="margin-bottom: 10px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px;">
                    <summary style="padding: 8px 12px; font-size: 0.85rem; font-weight: bold; color: #1e3a8a; cursor: pointer; list-style-position: inside;">
                        📖 [${q.passageRange}] 공통 지문 확인하기
                    </summary>
                    <div style="padding: 10px; border-top: 1px solid #cbd5e1; font-size: 0.85rem; color: #475569; max-height: 150px; overflow-y: auto; white-space: pre-wrap;">${q.passageContent}</div>
                </details>
            `;
        }

        qCard.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem;">
                <div style="font-weight: bold; color: #ea580c; display: flex; align-items: center; gap: 5px;">
                    [문항 <input type="text" value="${q.num}" oninput="extractedQuestionsArray[${idx}].num = this.value" style="width: 65px; padding: 2px; border: 1px solid #cbd5e1; border-radius: 4px; text-align: center; font-weight: bold; color: #ea580c;">]
                </div>
                <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                    <select id="ai-diff-${idx}" style="padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px; max-width: 200px;">
                        <option value="" disabled selected>난이도 선택</option>
                        <option value="상">상</option>
                        <option value="중">중</option>
                        <option value="하">하</option>
                    </select>
                    <label style="font-size: 0.85rem; margin-left: 5px;">배점:</label>
                    <input type="number" step="0.1" class="path2-score-input" value="${q.score || 0}" 
                           onchange="extractedQuestionsArray[${idx}].score = this.value"
                           style="width: 55px; padding: 4px; border: 1px solid #cbd5e1; border-radius: 4px;">
                    <button onclick="deleteQuestion(${idx})" style="background:#fee2e2; color:#ef4444; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:0.8rem;">삭제</button>
                    ${idx > 0 ? `<button onclick="mergeWithPrevious(${idx})" style="background:#f1f5f9; border:1px solid #cbd5e1; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:0.8rem;">위와 합치기</button>` : ''}
                </div>
            </div>
            
            <div style="font-size: 0.85rem; color: #64748b; margin-bottom: 3px; font-weight: bold;">✏️ 문항 텍스트 원본 수정 (수식이나 화학식은 $ 기호로 감싸주세요)</div>
            <textarea class="q-edit-area" oninput="updateMathPreview(${idx}, this.value)"
                      style="width: 100%; height: 100px; border: 1px solid #cbd5e1; border-radius: 4px; padding: 8px; font-family: inherit; margin-bottom: 10px; line-height: 1.5;">${q.text}</textarea>
            
            <div id="math-preview-section-${idx}">
                <div style="font-size: 0.85rem; font-weight: bold; color: #3b82f6; margin-bottom: 3px;">👀 최종 출력 미리보기 (수식 자동 변환)</div>
                <div id="math-preview-${idx}" style="padding: 10px; background: #f8fafc; border: 1px dashed #3b82f6; border-radius: 4px; font-size: 0.95rem; min-height: 40px; margin-bottom: 10px; line-height: 1.6;">
                    ${q.text.replace(/\n/g, '<br>')}
                </div>
            </div>

            <div id="q-image-container-${idx}" style="margin-top: 10px; text-align: center;">
                ${q.image ? `
                    <div style="position: relative; display: inline-block; max-width: 100%;">
                        <img src="${q.image}" style="max-width:100%; border:1px solid #e2e8f0; border-radius:4px;">
                        <button onclick="removeQuestionImage(${idx})" style="position: absolute; top: 5px; right: 5px; background: #ef4444; color: white; border: none; border-radius: 4px; padding: 3px 8px; font-size: 0.75rem; cursor: pointer; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">❌ 그림 지우기</button>
                    </div>
                ` : ''}
            </div>
            
            <div style="background: #fffbeb; border: 1px solid #fde68a; padding: 10px; border-radius: 6px; margin-top: 10px; text-align: left;">
                <p style="margin: 0 0 5px 0; font-size: 0.85rem; font-weight: bold; color: #92400e;">🖼️ 그림/도표 넣는 방법</p>
                <p style="margin: 0 0 10px 0; font-size: 0.75rem; color: #b45309; line-height: 1.5;">
                    💡 <strong>자체 캡처:</strong> 지금 시스템의 왼쪽 화면에 띄워진 이미지를 마우스로 직접 드래그해서 찍습니다.<br>
                    💡 <strong>캡처 후 클릭(붙여넣기로 추가됨):</strong> 단축키(Win+Shift+S)나 알캡처로 <strong>미리 복사해 둔 이미지</strong>를 불러옵니다. PDF 파일인 경우 이 버튼을 사용하세요.
                </p>
                <div style="display: flex; gap: 5px; flex-wrap: wrap;">
                    <button onclick="startPartialCapture(${idx})" style="background:#f1f5f9; border:1px solid #cbd5e1; padding:6px 10px; border-radius:4px; cursor:pointer; font-size:0.8rem;">📸 자체 캡처 (이미지용)</button>
                    <button onclick="pasteImageToQuestion(${idx})" style="background:#fef3c7; border:1px solid #fde68a; color:#92400e; padding:6px 10px; border-radius:4px; cursor:pointer; font-size:0.8rem; font-weight:bold;">📋 복사한 그림 붙여넣기 (PDF용)</button>
                </div>
            </div>
        `;
        listContainer.appendChild(qCard);
    });

    let applyBtnContainer = document.getElementById('external-apply-btn-zone');
    if (!applyBtnContainer) {
        applyBtnContainer = document.createElement('div');
        applyBtnContainer.id = 'external-apply-btn-zone';
        applyBtnContainer.style.textAlign = 'right';
        applyBtnContainer.style.margin = '15px 0';
        
        const wrapper = document.getElementById('exam-inspector-wrapper');
        if (wrapper) wrapper.parentNode.insertBefore(applyBtnContainer, wrapper.nextSibling);
    }
    
    if (extractedQuestionsArray.length > 0) {
        applyBtnContainer.innerHTML = `
            <div style="background: #f0fdf4; padding: 1.5rem; border-radius: 8px; border: 1px solid #bbf7d0; text-align: center; margin-bottom: 1rem;">
                <h4 style="margin: 0 0 10px 0; color: #166534; font-size: 1.1rem;">💡 성취평가제 신뢰도 제고에 기여해 주세요!</h4>
                <p style="margin: 0 0 1.5rem 0; font-size: 0.9rem; color: #15803d; line-height: 1.6; text-align: center;">
                    분석된 시험지 문항들을 문제은행에 공유해 주시겠습니까?<br>
                    (저작권 보호를 위해 AI가 숫자와 상황을 변형하여 안전하게 저장합니다.)
                </p>
                <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                    <button class="save-btn" onclick="saveBankAndApplyTable()" style="background: #10b981; display: inline-block; width: auto; margin: 0; box-shadow: 0 4px 6px rgba(0,0,0,0.2); font-size: 1.05rem;">💾 문제은행에 저장하고 표에 반영</button>
                    <button class="save-btn" onclick="sendAiResultsToTable()" style="background: #64748b; display: inline-block; width: auto; margin: 0; box-shadow: 0 4px 6px rgba(0,0,0,0.2); font-size: 1.05rem;">🗑️ 저장하지 않고 표에만 반영</button>
                </div>
            </div>
        `;
        applyBtnContainer.style.display = 'block';
    } else {
        applyBtnContainer.style.display = 'none';
    }

    if (window.MathJax) MathJax.typesetPromise([listContainer]);
}



// 💡 함수 바깥에 타이머 변수를 하나 만들어 둡니다.
let mathJaxTimer = null;

function updateMathPreview(idx, newText) {
    // 1. 원본 데이터 배열에 즉시 저장 (데이터 유실 방지)
    extractedQuestionsArray[idx].text = newText;
    
    const previewEl = document.getElementById(`math-preview-${idx}`);
    if (previewEl) {
        // 2. 화면에 글자는 딜레이 없이 즉각적으로 보여줍니다.
        previewEl.innerHTML = newText.replace(/\n/g, '<br>');
        
        // 3. 타이머 초기화 (연속으로 타자를 치고 있으면 아래 4번이 대기함)
        clearTimeout(mathJaxTimer);
        
        // 4. 타자를 멈추고 0.5초(500ms)가 지나면, 그때 딱 한 번만 무거운 수식 변환을 실행합니다.
        mathJaxTimer = setTimeout(() => {
            if (window.MathJax && window.MathJax.typesetPromise) {
                MathJax.typesetClear([previewEl]);
                MathJax.typesetPromise([previewEl]).catch(err => console.error('수식 변환 에러:', err));
            }
        }, 500);
    }
}

// ✨ [복구] 캡처 관련 변수 및 이벤트 리스너
let isCapturing = false;
let capStartX = 0, capStartY = 0;
let currentCaptureQIdx = -1;

function startPartialCapture(idx) {
    const canvas = document.getElementById('exam-capture-canvas');
    const imgEl = document.getElementById('exam-img-display'); 
    const pdfEl = document.getElementById('exam-pdf-display'); 

    // 🟢 PDF가 화면에 떠 있는 경우, 친절한 안내 메시지 띄우기
    if (pdfEl && pdfEl.style.display === 'block') {
        alert("💡 [PDF 캡처 안내]\n\n웹 브라우저 보안 정책상 PDF는 이 버튼으로 직접 캡처할 수 없습니다.\n\n대신 키보드의 [윈도우키 + Shift + S]를 눌러 캡처하신 후, 옆에 있는 노란색 [복사한 그림 붙여넣기] 버튼을 이용해 주세요!");
        return; 
    }

    if(!canvas) return;

    currentCaptureQIdx = idx;
    isCapturing = true;

    // 도화지 크기를 이미지 크기에 맞게 조절
    if(imgEl && imgEl.style.display !== 'none') {
        canvas.width = imgEl.clientWidth;
        canvas.height = imgEl.clientHeight;
    }

    canvas.style.display = 'block';
    canvas.style.cursor = 'crosshair';
    alert("📸 왼쪽 화면에서 그림 영역을 드래그하여 캡처하세요.");
}

// 캔버스 마우스 이벤트 등록 (window.onload 내부 또는 파일 끝에 추가)
function initCaptureEvents() {
    const canvas = document.getElementById('exam-capture-canvas');
    if(!canvas) return;
    const ctx = canvas.getContext('2d');

    canvas.onmousedown = (e) => {
        if(!isCapturing) return;
        const rect = canvas.getBoundingClientRect();
        capStartX = e.clientX - rect.left;
        capStartY = e.clientY - rect.top;
    };

    canvas.onmousemove = (e) => {
        if(!isCapturing) return;
        const rect = canvas.getBoundingClientRect();
        const curX = e.clientX - rect.left;
        const curY = e.clientY - rect.top;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.strokeRect(capStartX, capStartY, curX - capStartX, curY - capStartY);
    };

    canvas.onmouseup = (e) => {
        if(!isCapturing) return;
        const rect = canvas.getBoundingClientRect();
        const endX = e.clientX - rect.left;
        const endY = e.clientY - rect.top;

        // 실제 이미지에서 영역 잘라내기
        const imgEl = document.getElementById('exam-img-display');
        const tempCanvas = document.createElement('canvas');
        const tCtx = tempCanvas.getContext('2d');
        
        const scaleX = imgEl.naturalWidth / imgEl.clientWidth;
        const scaleY = imgEl.naturalHeight / imgEl.clientHeight;

        const w = (endX - capStartX) * scaleX;
        const h = (endY - capStartY) * scaleY;
        
        tempCanvas.width = w;
        tempCanvas.height = h;
        tCtx.drawImage(imgEl, capStartX * scaleX, capStartY * scaleY, w, h, 0, 0, w, h);
        
        // 해당 문항에 이미지 저장
        extractedQuestionsArray[currentCaptureQIdx].image = tempCanvas.toDataURL('image/png');
        
        // 상태 초기화
        isCapturing = false;
        canvas.style.display = 'none';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        renderQuestionCards(); // 화면 갱신
    };
}
// window.onload 끝부분에 initCaptureEvents(); 를 호출하도록 추가하세요.



// ==========================================
// 🤖 스마트 챗봇 창 크기 조절 (왼쪽은 얼음, 오른쪽 빈 공간으로만 확장)
// ==========================================
let isResizingChat = false;
let chatStartX = 0;
let chatStartWidth = 0;
let leftPanelStartWidth = 0;

function initChatResizer() {
    const resizer = document.getElementById('chat-resizer-left'); 
    const chatContainer = document.getElementById('ai-chat-container');

    if(!resizer || !chatContainer) return;

    resizer.addEventListener('mousedown', (e) => {
        isResizingChat = true;
        chatStartX = e.clientX;
        chatStartWidth = chatContainer.getBoundingClientRect().width;

        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizingChat) return;
        
        // 💡 마우스가 왼쪽으로 갈수록 너비가 늘어납니다 (문제 영역을 덮음)
        const diff = chatStartX - e.clientX;
        const newWidth = chatStartWidth + diff;

        if (newWidth > 250 && newWidth < window.innerWidth * 0.9) {
            chatContainer.style.width = newWidth + 'px';
        }
    });

    document.addEventListener('mouseup', () => {
        if(isResizingChat) {
            isResizingChat = false;
            document.body.style.cursor = 'default';
            document.body.style.userSelect = 'auto';
        }
    });
}



// 페이지 로드 시 크기 조절 기능 활성화
const originalOnload = window.onload;

// ==========================================
// 🛠️ 관리자 모드: 기존 성취기준 수정 및 삭제 로직
// ==========================================
async function loadStandardsForEdit() {
    const subject = document.getElementById('admin-edit-subject').value;
    const stdSelect = document.getElementById('admin-edit-standard');
    const editFields = document.getElementById('admin-edit-fields');
    
    stdSelect.innerHTML = '<option value="">데이터를 불러오는 중입니다...</option>';
    editFields.style.display = 'none'; // 다른 과목 선택 시 창 숨기기

    if (!subject) {
        stdSelect.innerHTML = '<option value="">앞에서 과목을 먼저 선택해 주세요</option>';
        return;
    }

    try {
        const snapshot = await db.collection('standards_2022').where('subject', '==', subject).get();
        let stds = [];
        snapshot.forEach(doc => stds.push({ id: doc.id, ...doc.data() }));
        stds.sort((a,b) => a.code.localeCompare(b.code));

        stdSelect.innerHTML = '<option value="">-- 수정할 성취기준을 선택하세요 --</option>';
        stds.forEach(std => {
            const option = document.createElement('option');
            option.value = std.id;
            option.text = `${std.code} ${std.desc.substring(0, 20)}...`;
            // 🌟 꿀팁: 선택 시 서버에 다시 요청하지 않도록 옵션 태그 안에 데이터를 숨겨둡니다.
            option.dataset.code = std.code || '';
            option.dataset.desc = std.desc || '';
            option.dataset.l_high = std.levels?.high || '';
            option.dataset.l_b = std.levels?.b || '';
            option.dataset.l_mid = std.levels?.mid || '';
            option.dataset.l_d = std.levels?.d || '';
            option.dataset.l_low = std.levels?.low || '';
            stdSelect.appendChild(option);
        });
    } catch (error) {
        stdSelect.innerHTML = '<option value="">불러오기 오류 발생</option>';
    }
}

function populateEditFields() {
    const select = document.getElementById('admin-edit-standard');
    const editFields = document.getElementById('admin-edit-fields');
    const option = select.options[select.selectedIndex];

    if (!option.value) {
        editFields.style.display = 'none';
        return;
    }

    // 숨겨둔 데이터를 꺼내어 입력칸(input)에 예쁘게 채워줍니다.
    document.getElementById('edit-code').value = option.dataset.code;
    document.getElementById('edit-desc').value = option.dataset.desc;
    document.getElementById('edit-level-high').value = option.dataset.l_high;
    document.getElementById('edit-level-b').value = option.dataset.l_b;
    document.getElementById('edit-level-mid').value = option.dataset.l_mid;
    document.getElementById('edit-level-d').value = option.dataset.l_d;
    document.getElementById('edit-level-low').value = option.dataset.l_low;

    editFields.style.display = 'block'; // 입력창 짠! 나타나기
}

async function updateStandardInDB() {
    const docId = document.getElementById('admin-edit-standard').value;
    if (!docId) return;

    const updatedData = {
        code: document.getElementById('edit-code').value.trim(),
        desc: document.getElementById('edit-desc').value.trim(),
        levels: {
            high: document.getElementById('edit-level-high').value.trim(),
            b: document.getElementById('edit-level-b').value.trim(),
            mid: document.getElementById('edit-level-mid').value.trim(),
            d: document.getElementById('edit-level-d').value.trim(),
            low: document.getElementById('edit-level-low').value.trim()
        }
    };

    if (!updatedData.code || !updatedData.desc) {
        alert("성취기준 코드와 내용은 필수입니다!");
        return;
    }

    if(confirm("이대로 덮어쓰시겠습니까? (기존 내용은 사라집니다)")) {
        try {
            await db.collection('standards_2022').doc(docId).update(updatedData);
            alert("✅ 성공적으로 수정되었습니다!");
            
            // 💡 [핵심 추가] 수첩 데이터 초기화
            localStorage.removeItem('saved_subject_data'); 
            
            location.reload(); 
        } catch(e) { alert("수정 실패: " + e.message); }
    }
}

async function deleteStandardFromDB() {
    const docId = document.getElementById('admin-edit-standard').value;
    if (!docId) return;

    if(confirm("🚨 정말로 이 성취기준을 삭제하시겠습니까?\n한 번 삭제하면 되돌릴 수 없습니다!")) {
        try {
            await db.collection('standards_2022').doc(docId).delete();
            alert("🗑️ 성취기준이 삭제되었습니다.");
            
            // 💡 [핵심 추가] 수첩 데이터 초기화
            localStorage.removeItem('saved_subject_data'); 
            
            location.reload();
        } catch(e) { alert("삭제 실패: " + e.message); }
    }
}

// ==========================================
// 🛠️ 관리자 모드: 기존 문항(Question) 수정 및 삭제 로직
// ==========================================
let currentEditingAllQuestions = {}; // 배열([])에서 객체({})로 변경!

async function loadQuestionsForEdit() {
    const stdSelect = document.getElementById('admin-manage-q-standard');
    const docId = stdSelect.value;
    const fields = document.getElementById('question-edit-fields');
    if(fields) fields.style.display = 'none';

    const qSelect = document.getElementById('admin-manage-q-list');
    if (!docId) {
        if(qSelect) qSelect.innerHTML = '<option value="">-- 성취기준을 먼저 선택하세요 --</option>';
        return;
    }

    qSelect.innerHTML = '<option value="">문항을 불러오는 중... ⏳</option>';

    try {
        // 💡 선택된 성취기준의 진짜 코드를 DB에서 안전하게 가져옵니다.
        const stdDoc = await db.collection('standards_2022').doc(docId).get();
        if (!stdDoc.exists) throw new Error("성취기준 없음");
        const stdCode = stdDoc.data().code.replace(/[\[\]\s]/g, '');

        // 💡 배열 내 포함 여부를 검사하는 array-contains 활용
        const snapshot = await db.collection('transformed_bank')
                         .where('standard_code', 'array-contains', stdCode)
                         .get();
        
        currentEditingAllQuestions = {}; // 초기화
        qSelect.innerHTML = '<option value="">-- 수정할 문항 선택 --</option>';

        if (snapshot.empty) {
            qSelect.innerHTML = '<option value="">등록된 문항이 없습니다.</option>';
            return;
        }

        snapshot.forEach(doc => {
            const data = doc.data();
            currentEditingAllQuestions[doc.id] = { id: doc.id, ...data }; 
            qSelect.innerHTML += `<option value="${doc.id}">[${data.level}] ${data.question.substring(0, 30)}...</option>`;
        });
    } catch (error) {
        qSelect.innerHTML = '<option value="">데이터 로드 실패</option>';
    }
}


function populateQuestionEditFields() {
    const qDocId = document.getElementById('admin-manage-q-list').value;
    const fields = document.getElementById('question-edit-fields');
    if (!qDocId) { fields.style.display = 'none'; return; }

    const q = currentEditingAllQuestions[qDocId];
    if (!q) return;

    // 💡 DB 필드명 매핑 보정 완벽 적용
    document.getElementById('manage-q-text').value = q.question || q.q || "";
    document.getElementById('manage-q-answer').value = q.answer || "";
    document.getElementById('manage-q-level').value = q.level || "C";
    document.getElementById('manage-q-reason').value = q.reason || "";
    fields.style.display = 'block';
}

// 문항 수정 저장
async function updateQuestionInDB() {
    const qDocId = document.getElementById('admin-manage-q-list').value;
    if (!qDocId) return;

    const updatedData = {
        question: document.getElementById('manage-q-text').value.trim(),
        answer: document.getElementById('manage-q-answer').value.trim(),
        level: document.getElementById('manage-q-level').value,
        reason: document.getElementById('manage-q-reason').value.trim()
    };

    if (confirm("문항 내용을 수정하시겠습니까?")) {
        try {
            await db.collection('transformed_bank').doc(qDocId).update(updatedData);
            alert("✅ 문항이 성공적으로 수정되었습니다!");
            loadQuestionsForEdit(); // 목록 새로고침
        } catch(e) { alert("수정 실패: " + e.message); }
    }
}

// 👇 업데이트 중 실수로 삭제된 함수입니다. 이곳에 다시 붙여넣어 주세요! 👇
async function deleteQuestionFromDB() {
    const qDocId = document.getElementById('admin-manage-q-list').value;
    if (!qDocId) {
        alert("먼저 삭제할 문항을 선택해주세요.");
        return;
    }

    if (confirm("🚨 이 문항을 문제은행(DB)에서 영구 삭제하시겠습니까?")) {
        try {
            await db.collection('transformed_bank').doc(qDocId).delete();
            alert("🗑️ 문항이 삭제되었습니다.");
            
            // 삭제 후 입력창 숨기기
            const fields = document.getElementById('question-edit-fields');
            if(fields) fields.style.display = 'none';
            
            loadQuestionsForEdit(); // 목록 새로고침
        } catch(e) { 
            alert("삭제 실패: " + e.message); 
        }
    }
}

// ✨ 관리자 도구 전용: 선택적 AI 핀셋 수정 실행 함수 
async function runTweezerRepair() {
    const qTextEl = document.getElementById('manage-q-text');
    const qSvgEl = document.getElementById('manage-q-svg-code');
    const qAnswerEl = document.getElementById('manage-q-answer');
    const qLevelEl = document.getElementById('manage-q-level');
    const qReasonEl = document.getElementById('manage-q-reason');
    const stdSelect = document.getElementById('admin-manage-q-standard');

    // 사용자가 체크한 항목들 파악
    const doQ = document.getElementById('chk-repair-q').checked;
    const doI = document.getElementById('chk-repair-i').checked;
    const doA = document.getElementById('chk-repair-a').checked;
    const doS = document.getElementById('chk-repair-s').checked;
    const doL = document.getElementById('chk-repair-l').checked;
    const doR = document.getElementById('chk-repair-r').checked;

    if (!doQ && !doA && !doS && !doL && !doR && !doI) {
        alert("복원할 항목을 최소 하나 이상 체크해주세요.");
        return;
    }

    if (!qTextEl.value.trim()) {
        alert("문항 텍스트가 최소한 한 줄은 있어야 AI가 유추할 수 있습니다.");
        return;
    }

    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
        alert("API 키가 필요합니다."); return;
    }

    const btn = document.getElementById('btn-tweezer-repair');
    const originalText = btn.innerText;
    btn.innerText = "⏳ 정밀 복원 중...";
    btn.disabled = true;

    try {
        const stdText = stdSelect.options[stdSelect.selectedIndex] ? stdSelect.options[stdSelect.selectedIndex].text : "미분류";
        const workerUrl = "https://script.google.com/macros/s/AKfycbwgx4RgF8FQxxL3jBgEQ5l369llADjhZ1NepulIdF4DdX18kBrB8oRQ4Ft0d5WdKtEF/exec";
        
        const response = await fetch(workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: "tweezer_repair",
                qText: qTextEl.value,
                qAnswer: qAnswerEl.value,
                qLevel: qLevelEl.value,
                qReason: qReasonEl.value,
                standardsInfo: stdText,
                apiKey: apiKey
            })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error.message);

        const aiText = data.candidates[0].content.parts[0].text;

        const matchQ = aiText.match(/\[수정_문제\]:?\s*([\s\S]*?)(?=\n*\[수정_그림\]|$)/);
        const matchI = aiText.match(/\[수정_그림\]:?\s*([\s\S]*?)(?=\n*\[수정_정답\]|$)/); // 💡 이미지 추출
        const matchA = aiText.match(/\[수정_정답\]:?\s*([\s\S]*?)(?=\n*\[수정_기준\]|$)/);
        const matchS = aiText.match(/\[수정_기준\]:?\s*([^[\]\n]+)/);
        const matchL = aiText.match(/\[수정_수준\]:?\s*([A-E])/);
        const matchR = aiText.match(/\[수정_이유\]:?\s*([\s\S]*)/);

        // 💡 체크된 항목만 선별적으로 덮어쓰기!
        if (doQ && matchQ && matchQ[1].trim()) {
            qTextEl.value = matchQ[1].trim();
            qTextEl.style.backgroundColor = '#fef08a';
        }
        if (doI && matchI && matchI[1].trim() && matchI[1].trim() !== '없음') {
            let newSvg = matchI[1].trim();
            // 💡 [수정 1] 백틱 제거와 함께, AI가 뱉어낸 특수문자(&lt;)를 정상적인 HTML 태그(<)로 완벽히 복원합니다.
            newSvg = newSvg.replace(/```svg\n?/gi, '')
                           .replace(/```/g, '')
                           .replace(/&lt;/g, '<')
                           .replace(/&gt;/g, '>')
                           .replace(/&amp;/g, '&');

            // 🛡️ [안전장치 추가] AI가 xmlns 속성을 빼먹었을 경우 강제 주입
            if (!newSvg.includes('xmlns=')) {
                newSvg = newSvg.replace('<svg', '<svg xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"');
            }
            // 🛡️ 배경이 투명해서 안 보일 수 있으니 기본 스타일 보정 (선택 사항)
            if (!newSvg.includes('viewBox=')) {
                newSvg = newSvg.replace('<svg', '<svg viewBox="0 0 300 300" style="background:white; max-width:100%;"');
            }

            // 1. 기존 텍스트(DB 저장용)에 코드 추가
            if (qTextEl.value.indexOf('<svg') === -1) { 
                qTextEl.value += `\n\n${newSvg}`;
                qTextEl.style.backgroundColor = '#fef08a';
            }

            // 2. 💡 새로 추가된 부분: 화면에 그림 렌더링하기
            const previewEl = document.getElementById('manage-q-svg-preview');
            if (previewEl) {
                previewEl.innerHTML = newSvg; // SVG 태그를 인식하여 그림을 그립니다
                previewEl.style.backgroundColor = '#fef08a';
            }
        }
        if (doA && matchA && matchA[1].trim()) {
            qAnswerEl.value = matchA[1].trim();
            qAnswerEl.style.backgroundColor = '#fef08a';
        }
        if (doL && matchL && matchL[1].trim()) {
            qLevelEl.value = matchL[1].trim();
            qLevelEl.style.backgroundColor = '#fef08a';
        }
        if (doR && matchR && matchR[1].trim()) {
            qReasonEl.value = matchR[1].trim();
            qReasonEl.style.backgroundColor = '#fef08a';
        }
        if (doS && matchS && matchS[1].trim()) {
            const foundCode = matchS[1].trim();
            // select box에서 해당 코드를 찾아 선택 상태로 변경
            for(let i=0; i<stdSelect.options.length; i++){
                if(stdSelect.options[i].value.includes(foundCode)) {
                    stdSelect.selectedIndex = i;
                    stdSelect.style.backgroundColor = '#fef08a';
                    break;
                }
            }
        }

        setTimeout(() => {
            [qTextEl, qAnswerEl, qLevelEl, qReasonEl, stdSelect, qSvgEl].forEach(el => {
                if(el) el.style.backgroundColor = '';
            });
            const previewEl = document.getElementById('manage-q-svg-preview');
            if (previewEl) previewEl.style.backgroundColor = '';
        }, 2000);

        alert("✨ 선택하신 항목들의 AI 복원이 완료되었습니다!\n확인 후 [💾 수정 내용 DB 저장]을 눌러주세요.");

    } catch (e) {
        alert("복원 실패: " + e.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

// ==========================================
// 📂 사용자 폴더(프로젝트) 관리 시스템 (분할점수 산출용)
// ==========================================
let currentProjectId = null;

async function loadProjects() {
    const user = auth.currentUser;
    const listEl = document.getElementById('project-folder-list');
    
    if(!user) {
        listEl.innerHTML = '<p style="color:#ef4444; grid-column: 1 / -1; text-align: center;">⚠️ 폴더를 관리하려면 구글 로그인이 필요합니다.</p>';
        return;
    }

    listEl.innerHTML = '<p style="color: #64748b; grid-column: 1 / -1; text-align: center;">폴더를 불러오는 중...</p>';

    try {
        const myOwnSnapshot = await db.collection('user_projects').where('ownerEmail', '==', user.email).get();
        const sharedSnapshot = await db.collection('user_projects').where('collaborators', 'array-contains', user.email).get();
        
        let myProjects = [];
        myOwnSnapshot.forEach(doc => myProjects.push({ id: doc.id, ...doc.data() }));
        
        let sharedProjects = [];
        sharedSnapshot.forEach(doc => {
            if (doc.data().uid !== user.uid) sharedProjects.push({ id: doc.id, ...doc.data() }); 
        });
        
        const sortByDate = (a, b) => (b.createdAt ? b.createdAt.toMillis() : 0) - (a.createdAt ? a.createdAt.toMillis() : 0);
        myProjects.sort(sortByDate);
        sharedProjects.sort(sortByDate);

        if(myProjects.length === 0 && sharedProjects.length === 0) {
            listEl.innerHTML = '<p style="color:#64748b; grid-column: 1 / -1; text-align: center;">생성된 폴더가 없습니다. 우측 상단의 [+ 새 폴더 만들기]를 눌러보세요!</p>';
            return;
        }

        let html = '';

        const renderCards = (projects, isOwnerList) => {
            let cardHtml = '';
            projects.forEach(data => {
                const dateStr = data.createdAt ? data.createdAt.toDate().toLocaleDateString() : "방금 전";
                
                // 💡 1. 평가 상태 및 팀원별 (아이디:완료/대기) 텍스트 생성 로직
                let allMembers = data.collaborators || [];
                if (data.ownerEmail && !allMembers.includes(data.ownerEmail)) allMembers.unshift(data.ownerEmail);
                const collaborators = [...new Set(allMembers)];

                let badges = data.assessments && data.assessments.length > 0 
                    ? [...data.assessments].sort((a,b)=> (a.type==='written'&&b.type!=='written')?-1:1).map(a => {
                        
                        // 팀원별로 지필/수행 구분에 따라 완료 여부 체크
                        let statusArr = collaborators.map(email => {
                            let id = email.split('@')[0]; // 이메일에서 아이디 추출
                            let isDone = false;
                            if (a.type === 'written') {
                                isDone = a.teacherCutScores && a.teacherCutScores[email];
                            } else {
                                isDone = a.teacherManualScores && a.teacherManualScores[email];
                            }
                            // 💡 완료는 찐한 빨간색(눈에 띄게) 볼드체, 대기는 옅은 반투명 색상 처리
                            let statusHtml = isDone 
                                ? `<span style="color: #ff4d4d; font-weight: 900; text-shadow: 1px 1px 2px rgba(0,0,0,0.3);">완료</span>`
                                : `<span style="color: #cbd5e1; opacity: 0.6; font-weight: normal;">대기</span>`;
                                
                            return `${id}(${statusHtml})`;
                        });
                        
                        // 결과: "thkim:완료, test:대기"
                        let statusText = statusArr.join(', ');
                        
                        // 목록이 세로로 스크롤되며 쭉 나오도록 div 요소로 변경 (폭 100%)
                        return `<div style="background:${a.type === 'written' ? '#3b82f6' : '#10b981'}; color:white; padding:4px 8px; border-radius:4px; font-size:0.7rem; font-weight:bold; margin-bottom:4px; width:100%; box-sizing:border-box; word-break:keep-all; line-height:1.4;">
                            ${a.name} <br>
                            <span style="font-weight:normal; opacity:0.9; font-size:0.65rem;">(${statusText})</span>
                        </div>`;
                    }).join('') 
                    : '<span style="font-size: 0.8rem; color: #94a3b8;">평가 내역 없음</span>';
        
                const deleteBtn = isOwnerList ? `<button onclick="deleteProject('${data.id}', event)" style="position: absolute; top: 15px; right: 15px; background: #fee2e2; color: #ef4444; border: none; padding: 2px 5px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.65rem; z-index: 10;">폴더 삭제</button>` : '';
                const memberManagementBtns = isOwnerList ? `
                    <div style="position: absolute; top: 42px; right: 15px; display: flex; gap: 4px; z-index: 10;">
                        <button onclick="inviteCollaborator('${data.id}', event)" style="background: #dbeafe; color: #1e40af; border: none; padding: 2px 5px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.65rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">🤝 팀원 초대</button>
                    </div>
                ` : '';
                
                const listTop = isOwnerList ? '68px' : '10px';
                
                let memberHtml = `<div style="position: absolute; top: ${listTop}; right: 15px; display: flex; flex-direction: column; gap: 3px; align-items: flex-end; z-index: 5;">`;
                memberHtml += '<span style="font-size: 0.6rem; color: #64748b; font-weight: bold; margin-bottom: 2px;">👥 참여 명단:</span>';
                const memberList = data.collaborators ? data.collaborators : [auth.currentUser.email];
                
                memberList.forEach(memberEmail => {
                    const memberName = memberEmail.split('@')[0];
                    let removeBtn = '';
                    
                    if (isOwnerList && memberEmail !== auth.currentUser.email) {
                        removeBtn = `<button onclick="kickFromProject('${data.id}', '${memberEmail}', event)" style="margin-left: 4px; background: transparent; color: #ef4444; border: none; cursor: pointer; font-size: 0.75rem; font-weight: bold; padding: 0;">✕</button>`;
                    }
                    memberHtml += `<span style="font-size: 0.6rem; color: #10b981; font-weight: bold; background: #ecfdf5; padding: 2px 6px; border-radius: 4px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); white-space: nowrap; display: inline-flex; align-items: center;">👤 ${memberName} ${removeBtn}</span>`;
                });
                memberHtml += '</div>';
        
                // 💡 2. 레이아웃 분할: 위쪽(폴더정보)은 우측 여백을 주고, 아래쪽(배지)은 폭을 100% 쓰도록 변경
                cardHtml += `
                <div style="position: relative; border: 1px solid #cbd5e1; border-radius: 8px; padding: 1.5rem; background: white; cursor: pointer; display: flex; flex-direction: column; min-height: 140px; box-sizing: border-box; transition: 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.05);" 
                     onmouseover="this.style.borderColor='#3b82f6'; this.style.transform='translateY(-3px)';" 
                     onmouseout="this.style.borderColor='#cbd5e1'; this.style.transform='none';">
                     
                    ${deleteBtn}
                    ${memberManagementBtns}
                    ${memberHtml}
                    
                    <div onclick="openProject('${data.id}', '${data.name}')" style="padding-right: 90px; flex-grow: 1;">
                        <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">📁</div>
                        <h4 style="margin: 0 0 0.5rem 0; color: #1e293b; font-size: 1.1rem; word-break: keep-all;">${data.name}</h4>
                        <p style="margin: 0; font-size: 0.8rem; color: #64748b;">생성일: ${dateStr}</p>
                    </div>
                    
                    <div onclick="openProject('${data.id}', '${data.name}')" style="margin-top: 15px; border: 2px dashed #cbd5e1; border-left: 5px solid #3b82f6; border-radius: 6px; padding: 8px; background: #f8fafc; display: flex; flex-wrap: wrap; align-content: flex-start; gap: 4px; max-height: 75px; overflow-y: auto; width: 100%; box-sizing: border-box;">
                        ${badges}
                    </div>
                </div>`;
            });
            return cardHtml;
        };

        if (myProjects.length > 0) {
            html += `<div style="grid-column: 1 / -1; margin-top: 1rem;"><h3 style="color: #1e3a8a; border-bottom: 2px solid #e2e8f0; padding-bottom: 5px; margin-bottom: 10px;">👤 내가 만든 프로젝트</h3></div>`;
            html += renderCards(myProjects, true);
        }
        if (sharedProjects.length > 0) {
            html += `<div style="grid-column: 1 / -1; margin-top: 2rem;"><h3 style="color: #10b981; border-bottom: 2px solid #e2e8f0; padding-bottom: 5px; margin-bottom: 10px;">🤝 초대받은 협업 프로젝트</h3></div>`;
            html += renderCards(sharedProjects, false);
        }

        listEl.innerHTML = html;
    } catch(e) { listEl.innerHTML = '<p style="color:red; grid-column: 1 / -1;">폴더를 불러오는데 실패했습니다.</p>'; }
}

// 🟢 [추가됨] 폴더(프로젝트) 삭제 로직
async function deleteProject(projectId, event) {
    event.stopPropagation(); // 삭제 버튼 클릭 시 폴더 안으로 들어가는 것을 막음
    if(!confirm("⚠️ 정말로 이 폴더를 삭제하시겠습니까?\n내부에 저장된 모든 평가 내역이 영구 삭제됩니다!")) return;
    
    try {
        await db.collection('user_projects').doc(projectId).delete();
        alert("🗑️ 폴더가 성공적으로 삭제되었습니다.");
        loadProjects(); // 목록 새로고침
    } catch(e) {
        alert("삭제 중 오류가 발생했습니다: " + e.message);
    }
}

// 2. 새 폴더 만들기 (DB에 저장)
async function createNewProject() {
    const user = auth.currentUser;
    if(!user) { alert("로그인이 필요합니다."); return; }

    const projectName = prompt("새로운 폴더 이름을 입력하세요.\n(예: 2026학년도 1학기 A고등학교)");
    if(!projectName || projectName.trim() === "") return;

    try {
        await db.collection('user_projects').add({
            uid: user.uid,
            ownerEmail: user.email, // 💡 [추가] 폴더 방장의 이메일 기록
            collaborators: [user.email], // 💡 [추가] 이 폴더를 볼 수 있는 사람 명단 (처음엔 나 혼자)
            name: projectName.trim(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            assessments: [] 
        });
        alert("✨ 새 폴더가 생성되었습니다!");
        loadProjects(); // 화면 새로고침
    } catch(e) {
        alert("폴더 생성 실패: " + e.message);
    }
}

let currentActiveStep = 1; // 현재 열려있는 탭 번호

function goToStep(stepNum) {
    // 1. [핵심 업그레이드] 국어/영어(지문)뿐만 아니라 수학(이미지/텍스트) 작업 중인지 모두 검사합니다.
    const hasPassages = typeof commonPassages !== 'undefined' && commonPassages.length > 0;
    
    // 문제 이미지가 업로드 되어 있는지 확인
    const imageUpload = document.getElementById('question-image-upload');
    const hasImage = imageUpload && imageUpload.value !== '';
    
    // 텍스트가 입력되어 있는지 확인
    const textInput = document.getElementById('question-text');
    const hasText = textInput && textInput.value.trim() !== '';

    // 2. 작업 중인 내용이 단 하나라도 있다면 통합 경고창을 띄웁니다.
    if (hasPassages || hasImage || hasText) {
        const isLeave = confirm("⚠️ 현재 작업 중인 내용(지문, 이미지 또는 텍스트)이 있습니다.\n\n다른 메뉴로 이동하면 작업 내역이 모두 초기화됩니다. 계속하시겠습니까?");
        
        if (!isLeave) {
            return; // 취소 시 하던 작업을 유지하며 이동을 막음
        }
    }

    // 3. 선생님이 원하신 "완전 초기화" 로직 (경고창에서 확인을 눌렀거나, 아예 빈 화면이었을 경우 실행)
    
    // (1) 지문 데이터 완벽 비우기
    if (typeof commonPassages !== 'undefined') {
        commonPassages = [];
        const container = document.getElementById('common-passage-list'); 
        if (container) container.innerHTML = '';
    }

    // (2) 분할점수 폴더 화면 초기화 (상세 화면 닫고 폴더 목록으로)
    const projectDetail = document.getElementById('project-detail-view');
    const projectList = document.getElementById('project-list-view'); 
    if (projectDetail) projectDetail.style.display = 'none';
    if (projectList) projectList.style.display = 'block';

    // (3) 문항 매칭 화면 비우기 (업로드된 이미지, 미리보기 등 해제)
    if (typeof resetAnalysis === 'function') {
        resetAnalysis(); 
    }

    // (4) 잔여 텍스트 및 AI 분석 결과창 강제 청소
    const textInputs = ['question-text', 'chat-input']; 
    textInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    
    const resultAreas = document.querySelectorAll('.result-content, .analysis-result');
    resultAreas.forEach(el => el.innerHTML = '');


    // 4. 원래 목적이었던 '탭 화면 이동' 처리
    [1, 2, 3, 4].forEach(n => {
        const step = document.getElementById(`cut-score-step${n}`);
        if(step) step.style.display = 'none';
        const indicator = document.getElementById(`step${n}-indicator`);
        if(indicator) indicator.style.color = '#cbd5e1';
    });
    
    const targetStep = document.getElementById(`cut-score-step${stepNum}`);
    if(targetStep) targetStep.style.display = 'block';
    
    const indicatorTarget = document.getElementById(`step${stepNum}-indicator`);
    if(indicatorTarget) indicatorTarget.style.color = 'var(--primary)';
    
    currentActiveStep = stepNum; 
    window.scrollTo(0, 0); // 화면 맨 위로 정렬
}

async function openProject(projectId, projectName) {
    currentProjectId = projectId;
    
    document.getElementById('cut-score-dashboard').style.display = 'none';
    [1, 2, 3, 4].forEach(n => {
        const step = document.getElementById(`cut-score-step${n}`);
        if(step) step.style.display = 'none';
    });
    document.getElementById('dynamic-indicator-bar').style.display = 'none';

    // ✨ id 대신 class를 사용하여 내부/외부 버튼 모두 연동되도록 수정
    document.getElementById('project-detail-title').innerHTML = `📂 ${projectName} <button class="save-btn" onclick="openMemoBoard()" style="width: auto; margin: 0 0 0 15px; padding: 0.4rem 0.8rem; font-size: 0.85rem; background: #f59e0b; display: inline-block;">💬 업무 메모 <span class="unread-memo-badge" style="background: #ef4444; color: white; border-radius: 10px; padding: 2px 6px; font-size: 0.7rem; margin-left: 5px; display: none;">0</span></button>`;
    document.getElementById('project-detail-view').style.display = 'block';

    await loadProjectDetails();
}

function backToProjectList() {
    currentProjectId = null;
    document.getElementById('project-detail-view').style.display = 'none';
    document.getElementById('cut-score-dashboard').style.display = 'block';

    // 💡 [최적화 방어막 1] 폴더 밖으로 나가면 켜져 있던 실시간 CCTV(리스너)를 완벽히 끕니다!
    if (projectDetailsUnsubscribe) {
        projectDetailsUnsubscribe();
        projectDetailsUnsubscribe = null;
    }
    if (unsubscribeProject) {
        unsubscribeProject();
        unsubscribeProject = null;
    }

    loadProjects();
}

let projectDetailsUnsubscribe = null;

async function loadProjectDetails() {
    const listEl = document.getElementById('project-assessment-list');
    listEl.innerHTML = '<p style="text-align:center; padding: 1rem;">데이터를 불러오는 중입니다... ⏳</p>';
    
    if (projectDetailsUnsubscribe) {
        projectDetailsUnsubscribe();
    }

    // ✨ 한 번만 읽는 get() 대신 실시간 동기화 onSnapshot() 적용
    projectDetailsUnsubscribe = db.collection('user_projects').doc(currentProjectId).onSnapshot(doc => {
        if(doc.exists) {
            const data = doc.data();
            renderProjectAssessments(data.assessments || []);
            
            // ✨ 메인 폴더창 & 작업창의 '모든' 업무메모 뱃지 카운트 실시간 동기화
            const memos = data.memos || [];
            const userEmail = auth.currentUser.email;
            // 내가 쓰지 않고, 읽은 사람 목록에 내가 없는 메시지 카운트
            const unreadCount = memos.filter(m => m.authorEmail !== userEmail && !(m.readBy || []).includes(userEmail)).length;
            
            document.querySelectorAll('.unread-memo-badge').forEach(badge => {
                if (unreadCount > 0) {
                    badge.innerText = unreadCount;
                    badge.style.display = 'inline-block';
                } else {
                    badge.style.display = 'none';
                }
            });
        }
    }, error => {
        listEl.innerHTML = '<p style="color:red; text-align:center;">데이터를 불러오는 데 실패했습니다.</p>';
    });
}

// 👇 아래 코드로 통째로 교체해주세요!
function renderProjectAssessments(assessments) {
    const listEl = document.getElementById('project-assessment-list');
    const finalBoxes = document.getElementById('project-final-cut-scores');
    const warning = document.getElementById('weight-warning');
    
    if(!assessments || assessments.length === 0) {
        listEl.innerHTML = '<div style="text-align:center; background: #f8fafc; padding: 2rem; border-radius: 8px; border: 1px dashed #cbd5e1; color: #64748b;">아직 등록된 평가가 없습니다. 아래 버튼을 눌러 평가를 추가하세요.</div>';
        finalBoxes.innerHTML = '<p style="color: #64748b; font-size: 0.9rem;">평가를 추가하면 최종 점수가 이곳에 계산됩니다.</p>';
        warning.style.display = 'none';
        return;
    }

    let html = `
    <div style="text-align: right; margin-bottom: 10px;">
        <button id="global-edit-btn" onclick="toggleGlobalEditMode()" style="background:#f59e0b; color:white; border:none; padding:6px 12px; border-radius:6px; cursor:pointer; font-weight:bold; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: 0.2s;">✏️ 평가명/비율 일괄 수정</button>
    </div>
    <table class="score-table">
        <thead style="background: #f1f5f9;">
            <tr>
                <th style="text-align:center;">평가명</th>
                <th style="text-align:center;">반영 비율<br><span style="font-size:0.75rem; color:#64748b; font-weight:normal;">(100점 기준)</span></th>
                <th style="text-align:center;">A</th>
                <th style="text-align:center;">B</th>
                <th style="text-align:center;">C</th>
                <th style="text-align:center;">D</th>
                <th style="text-align:center;">E</th>
                <th style="text-align:center;">관리</th>
            </tr>
        </thead>
        <tbody>`;
    
    let totalWeight = 0;
    let totals = { A: 0, B: 0, C: 0, D: 0, E: 0 };

    let sortedWithIndex = assessments.map((asm, idx) => ({ ...asm, originalIndex: idx }));
    sortedWithIndex.sort((a, b) => {
        if (a.type === 'written' && b.type !== 'written') return -1;
        if (a.type !== 'written' && b.type === 'written') return 1;
        return 0;
    });

    sortedWithIndex.forEach((asm) => {
        const idx = asm.originalIndex; 
        const w = asm.weight || 0;
        totalWeight += w;

        // 실제 점수(반영 비율에 따른 점수)
        const sA = asm.scores?.A || 0;
        const sB = asm.scores?.B || 0;
        const sC = asm.scores?.C || 0;
        const sD = asm.scores?.D || 0;
        const sE = asm.scores?.E || 0;

        totals.A += sA; totals.B += sB; totals.C += sC; totals.D += sD; totals.E += sE;

        // 💡 100점 만점 환산 점수 계산
        const cA = w > 0 ? (sA / w) * 100 : 0;
        const cB = w > 0 ? (sB / w) * 100 : 0;
        const cC = w > 0 ? (sC / w) * 100 : 0;
        const cD = w > 0 ? (sD / w) * 100 : 0;
        const cE = w > 0 ? (sE / w) * 100 : 0;

        const nameColor = asm.type === 'written' ? '#1e40af' : '#166534';
        const typeBadge = asm.type === 'written' 
            ? `<span style="background:#3b82f6; color:white; padding:2px 4px; border-radius:4px; font-size:0.7rem; margin-right:5px;">지필</span>`
            : `<span style="background:#10b981; color:white; padding:2px 4px; border-radius:4px; font-size:0.7rem; margin-right:5px;">수행</span>`;

        const editBtn = asm.type === 'written' 
            ? `<button onclick="startEditAssessment(${idx})" style="background:#3b82f6; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; margin-right:5px;">산출/수정</button>` 
            : `<button onclick="editManualAssessment(${idx})" style="background:#8b5cf6; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; margin-right:5px;">수정</button>`;

        // 💡 실제 점수와 (100점 기준 환산점수)를 두 줄로 표기
        html += `<tr>
            <td style="text-align:left;">
                ${typeBadge}
                <strong class="display-name" style="color:${nameColor};">${asm.name}</strong>
                <input type="text" class="edit-name-input" data-idx="${idx}" value="${asm.name}" style="display:none; width:120px; padding:4px; border:1px solid #cbd5e1; border-radius:4px;">
            </td>
            <td style="text-align:center;">
                <div class="display-weight" style="color: #ea580c; font-weight: bold;">${w}%</div>
                <div class="display-weight-sub" style="font-size:0.75rem; color:#64748b; margin-top:2px;">(100점)</div>
                <input type="number" class="edit-weight-input" data-idx="${idx}" value="${w}" style="display:none; width:60px; padding:4px; border:1px solid #cbd5e1; border-radius:4px; text-align:center; margin: 0 auto;">
            </td>
            <td style="text-align:center;">
                <div style="font-weight:bold; color:#1e293b;">${sA.toFixed(2)}</div>
                <div style="font-size:0.75rem; color:#64748b; margin-top:2px;">(${Number(cA.toFixed(2))})</div>
            </td>
            <td style="text-align:center;">
                <div style="font-weight:bold; color:#1e293b;">${sB.toFixed(2)}</div>
                <div style="font-size:0.75rem; color:#64748b; margin-top:2px;">(${Number(cB.toFixed(2))})</div>
            </td>
            <td style="text-align:center;">
                <div style="font-weight:bold; color:#1e293b;">${sC.toFixed(2)}</div>
                <div style="font-size:0.75rem; color:#64748b; margin-top:2px;">(${Number(cC.toFixed(2))})</div>
            </td>
            <td style="text-align:center;">
                <div style="font-weight:bold; color:#1e293b;">${sD.toFixed(2)}</div>
                <div style="font-size:0.75rem; color:#64748b; margin-top:2px;">(${Number(cD.toFixed(2))})</div>
            </td>
            <td style="text-align:center;">
                <div style="font-weight:bold; color:#1e293b;">${sE.toFixed(2)}</div>
                <div style="font-size:0.75rem; color:#64748b; margin-top:2px;">(${Number(cE.toFixed(2))})</div>
            </td>
            <td style="text-align:center;">
                ${editBtn}
                <button onclick="deleteAssessment(${idx})" style="background:#ef4444; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">삭제</button>
            </td>
        </tr>`;
    });
    
    html += `</tbody>
        <tfoot style="background:#fffbeb; font-weight:bold;">
            <tr>
                <td style="text-align:center;">비율 합계</td>
                <td style="text-align:center; color:${totalWeight === 100 ? '#10b981' : '#ef4444'}">${totalWeight}%</td>
                <td colspan="6"></td>
            </tr>
        </tfoot>
    </table>`;

    listEl.innerHTML = html;

    finalBoxes.innerHTML = `
        <div style="flex:1; min-width: 100px; padding:15px; background:white; border: 2px solid #ef4444; border-radius:8px;"><strong>A 컷오프</strong><br><span style="font-size:1.6rem; font-weight:bold; color:#ef4444;">${totals.A.toFixed(2)}</span></div>
        <div style="flex:1; min-width: 100px; padding:15px; background:white; border: 2px solid #f59e0b; border-radius:8px;"><strong>B 컷오프</strong><br><span style="font-size:1.6rem; font-weight:bold; color:#f59e0b;">${totals.B.toFixed(2)}</span></div>
        <div style="flex:1; min-width: 100px; padding:15px; background:white; border: 2px solid #22c55e; border-radius:8px;"><strong>C 컷오프</strong><br><span style="font-size:1.6rem; font-weight:bold; color:#22c55e;">${totals.C.toFixed(2)}</span></div>
        <div style="flex:1; min-width: 100px; padding:15px; background:white; border: 2px solid #3b82f6; border-radius:8px;"><strong>D 컷오프</strong><br><span style="font-size:1.6rem; font-weight:bold; color:#3b82f6;">${totals.D.toFixed(2)}</span></div>
        <div style="flex:1; min-width: 100px; padding:15px; background:white; border: 2px solid #94a3b8; border-radius:8px;"><strong>E 컷오프</strong><br><span style="font-size:1.6rem; font-weight:bold; color:#64748b;">${totals.E.toFixed(2)}</span></div>
    `;

    warning.style.display = totalWeight !== 100 ? 'block' : 'none';
}

// 🟢 완벽하게 수정된 삭제 로직
async function deleteAssessment(index) {
    if(!confirm("이 평가 내역을 삭제하시겠습니까? (삭제 후 합산 점수가 재계산됩니다)")) return;
    try {
        const docRef = db.collection('user_projects').doc(currentProjectId);
        const doc = await docRef.get();
        if(doc.exists) {
            let assessments = doc.data().assessments || [];
            assessments.splice(index, 1); // 배열에서 해당 평가를 정확히 삭제
            await docRef.update({ assessments: assessments });
            loadProjectDetails();
        }
    } catch(e) { alert("삭제 실패: " + e.message); }
}

// 🟢 [방법 1 완벽 구현] 추출 화면에서 삭제 시: 뒤에 있는 문항들의 번호가 자연스럽게 앞당겨짐
function deleteQuestion(idx) {
    if (!confirm("이 문항을 삭제하시겠습니까?\n(삭제 시 아래에 있는 문항들의 번호가 하나씩 앞당겨집니다.)")) return;
    
    // 1. 지워질 문항이 객관식인지 서답형인지 기억해둡니다.
    const deletedItem = extractedQuestionsArray[idx];
    const wasShort = String(deletedItem.num).includes('서') || String(deletedItem.num).startsWith('서');
    
    // 2. 문항 삭제!
    extractedQuestionsArray.splice(idx, 1);
    
    // 3. 💡 스마트 당기기 로직: 지워진 위치 '이후'의 문항들만 번호를 1씩 뺍니다.
    for (let i = idx; i < extractedQuestionsArray.length; i++) {
        let q = extractedQuestionsArray[i];
        let isShort = String(q.num).includes('서') || String(q.num).startsWith('서');
        
        // 지워진 문항과 같은 유형(객관식은 객관식끼리, 서답형은 서답형끼리)일 때만 당김
        if (wasShort === isShort) {
            let numPart = parseInt(String(q.num).replace(/[^0-9]/g, ''));
            if (!isNaN(numPart) && numPart > 1) {
                // 15번이었으면 14번으로, 서6이었으면 서5로 변신
                q.num = isShort ? "서" + (numPart - 1) : String(numPart - 1);
            }
        }
    }
    
    renderQuestionCards();
}

// 🟢 [완벽 수정] 위 문항과 합치기 기능 (합칠 때도 번호가 당겨집니다!)
function mergeWithPrevious(idx) {
    if (idx <= 0) return;
    if(!confirm("이 문항의 텍스트를 위 문항과 합치시겠습니까?\n(합친 후 아래 문항들의 번호가 앞당겨집니다.)")) return;
    
    // 1. 텍스트 병합 및 이미지 이관
    extractedQuestionsArray[idx - 1].text += "\n" + extractedQuestionsArray[idx].text;
    if (!extractedQuestionsArray[idx - 1].image && extractedQuestionsArray[idx].image) {
        extractedQuestionsArray[idx - 1].image = extractedQuestionsArray[idx].image;
    }
    
    // 2. 현재 문항의 유형을 기억하고 삭제
    const wasShort = String(extractedQuestionsArray[idx].num).includes('서') || String(extractedQuestionsArray[idx].num).startsWith('서');
    extractedQuestionsArray.splice(idx, 1);
    
    // 3. 스마트 당기기 로직 (합쳐져서 한 칸 줄었으므로 아래 번호들을 당겨줍니다)
    for (let i = idx; i < extractedQuestionsArray.length; i++) {
        let q = extractedQuestionsArray[i];
        let isShort = String(q.num).includes('서') || String(q.num).startsWith('서');
        
        if (wasShort === isShort) {
            let numPart = parseInt(String(q.num).replace(/[^0-9]/g, ''));
            if (!isNaN(numPart) && numPart > 1) {
                q.num = isShort ? "서" + (numPart - 1) : String(numPart - 1);
            }
        }
    }
    
    renderQuestionCards();
}

// 🟢 [신규 추가] 첨부된 그림 조각 지우기 기능
function removeQuestionImage(idx) {
    if(confirm("이 문항에 첨부된 그림을 삭제하시겠습니까?")) {
        extractedQuestionsArray[idx].image = null;
        renderQuestionCards();
    }
}

// [수정 완료] 3. 악마의 번호 초기화 로직 삭제 (사용자가 입력한 번호 존중)
function rearrangeQuestionNumbers() {
    // 💡 무조건 1번부터 덮어쓰는 기존 로직을 완전 폐기했습니다!
    // 대신 배열 내부의 숫자 크기 순서대로 깔끔하게 정렬만 수행합니다.
    extractedQuestionsArray.sort((a, b) => {
        const aIsShort = String(a.num).startsWith('서');
        const bIsShort = String(b.num).startsWith('서');
        if (aIsShort && !bIsShort) return 1;
        if (!aIsShort && bIsShort) return -1;

        let aNum = parseInt(a.num.replace(/[^0-9]/g, '')) || 0;
        let bNum = parseInt(b.num.replace(/[^0-9]/g, '')) || 0;
        return aNum - bNum;
    });
}

function openManualAssessmentModal() { 
    document.getElementById('manual-assess-name').value = '';
    document.getElementById('manual-assess-weight').value = '';
    // ✨ 입력하지 않아도 0점이 되지 않도록 실제 값을 꽂아줍니다.
    document.getElementById('manual-a').value = '';
    document.getElementById('manual-b').value = '';
    document.getElementById('manual-c').value = '';
    document.getElementById('manual-d').value = '';
    document.getElementById('manual-e').value = '';
    
    document.getElementById('sub-factors-list').innerHTML = ''; 
    
    // 🌟 [버그 수정 1] 새 평가를 만들 때 기존 인덱스 완벽 초기화 (덮어쓰기 방지)
    currentEditingManualIndex = -1; 
    currentEditingAssessmentIndex = -1;

    // 🌟 [버그 수정 2] 창을 열 때 무조건 저장 버튼 잠금 해제
    const saveBtn = document.getElementById('btn-save-manual');
    if (saveBtn) {
        saveBtn.innerHTML = "💾 결과 저장하기";
        saveBtn.style.background = "#ea580c";
        saveBtn.disabled = false;
    }

    document.getElementById('manual-assessment-modal').style.display = 'flex'; 
}


let currentEditingManualIndex = -1;

// ✨ [수정됨] 수행평가 수정 창 열기 함수 (협업 블라인드 에러 완벽 해결 + CCTV 최적화)
function editManualAssessment(index) {
    // 💡 새로운 협업 시스템이 내가 몇 번째 평가를 누른 건지 알 수 있도록 네비게이션 설정
    currentEditingAssessmentIndex = index;
    currentEditingManualIndex = index;

    // 💡 [CCTV 최적화 1] 상세 작업에 들어왔으므로, 메인 폴더의 실시간 감시를 잠시 꺼서 데이터를 절약합니다.
    if (typeof projectDetailsUnsubscribe !== 'undefined' && projectDetailsUnsubscribe) {
        projectDetailsUnsubscribe();
        projectDetailsUnsubscribe = null;
    }

    db.collection('user_projects').doc(currentProjectId).get().then(doc => {
        if(doc.exists) {
            const projectData = doc.data();
            const asm = projectData.assessments[index];
            const myEmail = auth.currentUser.email;
            
            // 1. 평가명과 비율 등 기본 정보 세팅
            document.getElementById('manual-assess-name').value = asm.name || '';
            document.getElementById('manual-assess-weight').value = asm.weight || '';
            
            // 2. 선생님의 하위 평가요소 데이터(가, 나, 다 등) 복원
            const subList = document.getElementById('sub-factors-list');
            if(subList) subList.innerHTML = '';
            
            if (asm.subFactors && asm.subFactors.length > 0) {
                asm.subFactors.forEach(sf => {
                    if (typeof addSubFactorRow === 'function') addSubFactorRow(sf);
                });
            }
            
            // 3. 모달 창 열기
            const modal = document.getElementById('manual-assessment-modal');
            if(modal) modal.style.display = 'flex';

            // 4. [핵심] 새로 만든 협업 워크스페이스 실행! (이 안에서 수행평가 전용 CCTV가 켜집니다)
            if (typeof loadManualAssessmentWorkspace === 'function') {
                loadManualAssessmentWorkspace();
            } else {
                // (만약 새 시스템이 아직 연동 안 된 과도기일 경우를 위한 안전 방어막 - 기존 코드 완벽 유지)
                const ratio = asm.weight ? (asm.weight / 100) : 1;
                let target = (asm.teacherManualScores && asm.teacherManualScores[myEmail]) 
                             ? asm.teacherManualScores[myEmail] 
                             : (asm.scores || {A:0, B:0, C:0, D:0, E:0});
                
                document.getElementById('manual-a').value = Math.round((target.A || 0) / ratio);
                document.getElementById('manual-b').value = Math.round((target.B || 0) / ratio);
                document.getElementById('manual-c').value = Math.round((target.C || 0) / ratio);
                document.getElementById('manual-d').value = Math.round((target.D || 0) / ratio);
                document.getElementById('manual-e').value = Math.round((target.E || 0) / ratio);
            }
        }
    }).catch(e => {
        console.error("수행평가 로드 에러:", e);
        alert("불러오기 중 시스템 오류가 발생했습니다.");
    });
}

// ✨ 모달 닫기 (수행평가 CCTV 차단 및 폴더 복귀)
function closeManualAssessmentModal() { 
    document.getElementById('manual-assessment-modal').style.display = 'none';
    currentEditingManualIndex = -1; 
    
    document.querySelectorAll('#manual-assessment-modal input').forEach(input => {
        input.value = '';
        input.readOnly = false;
        input.style.background = 'white';
    }); 
    document.getElementById('sub-factors-list').innerHTML = ''; 
    
    // 💡 [CCTV 최적화 2] 창을 닫았으므로 수행평가 전용 실시간 감시의 전원을 뽑습니다. (데이터 절약 핵심!)
    if (typeof manualWorkspaceUnsubscribe !== 'undefined' && manualWorkspaceUnsubscribe) {
        manualWorkspaceUnsubscribe();
        manualWorkspaceUnsubscribe = null;
    }

    // 💡 [CCTV 복구 3] 메인 폴더로 돌아왔으므로 다시 폴더 겉면을 감시하는 스위치를 켭니다.
    if (currentProjectId) {
        if (typeof loadProjectDetails === 'function') loadProjectDetails();
    }
}


async function saveAssessmentToProject() {
    if (!currentProjectId || currentEditingAssessmentIndex === -1) { alert("오류: 편집 중인 평가를 찾을 수 없습니다."); return; }

    const boxes = document.getElementById('final-cut-score-boxes').querySelectorAll('span');
    if (boxes.length < 5) { alert("점수 산출이 먼저 완료되어야 합니다."); return; }

    const infoZone = document.getElementById('current-assessment-info');
    const saveBtn = document.getElementById('btn-save-m');

    saveBtn.innerHTML = "⏳ 저장 중...";
    saveBtn.style.background = "#94a3b8";
    saveBtn.style.cursor = "not-allowed";
    saveBtn.disabled = true;

    let latestScores = [];
    document.querySelectorAll('.score-input').forEach((input, idx) => {
        const selects = document.querySelectorAll('.level-select');
        const diffs = document.querySelectorAll('.diff-select');
        latestScores.push({
            num: input.getAttribute('data-num') || String(idx + 1), score: parseFloat(input.value) || 0,
            level: selects[idx] ? selects[idx].value : 'C', difficulty: diffs[idx] ? diffs[idx].value : '중',
            isShortAnswer: String(input.getAttribute('data-num')).includes('서')
        });
    });
    if(latestScores.length > 0) parsedScores = latestScores;

    let myMTable = [];
    document.querySelectorAll('#cut-score-result-table .cut-score-row').forEach(row => {
        myMTable.push({
            A: row.querySelector('.pct-A').value, B: row.querySelector('.pct-B').value,
            C: row.querySelector('.pct-C').value, D: row.querySelector('.pct-D').value, E: row.querySelector('.pct-E').value
        });
    });

    try {
        const docRef = db.collection('user_projects').doc(currentProjectId);
        const doc = await docRef.get();
        
        if(doc.exists) {
            let projectData = doc.data(); 
            let assessments = projectData.assessments || [];
            let asm = assessments[currentEditingAssessmentIndex];
            const weight = asm.weight || 0; 
            const examTitle = `${asm.name || '평가명 없음'} (${weight}%)`; 
            
            const myCut100 = {
                A: parseFloat(boxes[0].innerText.replace('점','')), B: parseFloat(boxes[1].innerText.replace('점','')),
                C: parseFloat(boxes[2].innerText.replace('점','')), D: parseFloat(boxes[3].innerText.replace('점','')), E: parseFloat(boxes[4].innerText.replace('점',''))
            };

            let allMembers = projectData.collaborators || [];
            if (projectData.ownerEmail && !allMembers.includes(projectData.ownerEmail)) allMembers.unshift(projectData.ownerEmail); 
            const currentUserEmail = auth.currentUser.email;
            if (!allMembers.includes(currentUserEmail)) allMembers.push(currentUserEmail); 
            const collaborators = [...new Set(allMembers)];

            if (!asm.teacherCutScores) asm.teacherCutScores = {};
            asm.teacherCutScores[currentUserEmail] = myCut100;
            if (!asm.teacherMTable) asm.teacherMTable = {};
            asm.teacherMTable[currentUserEmail] = myMTable;

            let missingTeachers = [];
            let statusHTML = `<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;">`;

            collaborators.forEach(email => {
                const name = email.split('@')[0];
                if (asm.teacherCutScores[email]) {
                    statusHTML += `<span style="background: #dcfce7; color: #166534; padding: 4px 8px; border-radius: 4px; border: 1px solid #86efac; font-size: 0.8rem; font-weight: bold;">✅ ${name}: 완료</span>`;
                } else {
                    missingTeachers.push(name);
                    statusHTML += `<span style="background: #f1f5f9; color: #64748b; padding: 4px 8px; border-radius: 4px; border: 1px solid #e2e8f0; font-size: 0.8rem; font-weight: bold;">⏳ ${name}: 대기</span>`;
                }
            });
            statusHTML += `</div>`;

            let isFinal = (missingTeachers.length === 0);

            if (isFinal) {
                let avgCut100 = { A: 0, B: 0, C: 0, D: 0, E: 0 };
                let teacherCount = collaborators.length;
                
                // 💡 [버그 수정] 과거에 참여했던 삭제된 팀원의 데이터가 합산되지 않도록,
                // 현재 collaborators 목록에 있는 사람의 점수만 골라서 더합니다!
                collaborators.forEach(email => {
                    if (asm.teacherCutScores[email]) {
                        avgCut100.A += asm.teacherCutScores[email].A; 
                        avgCut100.B += asm.teacherCutScores[email].B;
                        avgCut100.C += asm.teacherCutScores[email].C; 
                        avgCut100.D += asm.teacherCutScores[email].D; 
                        avgCut100.E += asm.teacherCutScores[email].E;
                    }
                });
                
                avgCut100.A /= teacherCount; avgCut100.B /= teacherCount; avgCut100.C /= teacherCount; avgCut100.D /= teacherCount; avgCut100.E /= teacherCount;

                asm.scores = { A: avgCut100.A * (weight / 100), B: avgCut100.B * (weight / 100), C: avgCut100.C * (weight / 100), D: avgCut100.D * (weight / 100), E: avgCut100.E * (weight / 100) }; 
                
                infoZone.style.background = "#f0fdf4"; infoZone.style.border = "2px solid #22c55e";
                infoZone.innerHTML = `<div style="color:#1e3a8a; font-size:1.1rem; font-weight:900; margin-bottom:5px;">📌 ${examTitle}</div>` + 
                                     `<div style="color:#166534; font-size:0.9rem; font-weight:bold;">🎉 모든 교사 산출 완료!</div>` + statusHTML;

                const compareBtn = document.getElementById('btn-compare-m');
                if (compareBtn) { compareBtn.disabled = false; compareBtn.style.background = "#8b5cf6"; compareBtn.style.cursor = "pointer"; compareBtn.innerHTML = "📊 비교하기 (활성)"; }
                alert("✅ 결과 저장이 성공적으로 완료되었습니다!");
            } else {
                // 👇 [여기에 추가!] 아직 완료하지 않은 교사가 있다면 기존의 폴더 밖 점수를 삭제하여 블라인드 처리
                if (asm.scores) {
                    delete asm.scores;
                }

                infoZone.style.background = "#fffbeb"; infoZone.style.border = "2px solid #f59e0b";
                infoZone.innerHTML = `<div style="color:#1e3a8a; font-size:1.1rem; font-weight:900; margin-bottom:5px;">📌 ${examTitle}</div>` + 
                                     `<div style="color:#92400e; font-size:0.9rem; font-weight:bold;">💾 내 점수 저장 완료! (다른 교사 대기중)</div>` + statusHTML;
                alert("✅ 내 점수 저장이 임시 완료되었습니다.\n나머지 교사가 완료해야 최종 갱신됩니다.");
            }

            // 💡 [핵심] 저장 성공 시 입력칸 막힘 처리 및 초록색 버튼으로 변경
            document.querySelectorAll('.pct-input').forEach(input => {
                input.disabled = true;
                input.style.background = "#f1f5f9";
            });
            saveBtn.innerHTML = "✅ 저장 완료";
            saveBtn.style.background = "#10b981"; // 초록색
            saveBtn.disabled = true; // [수정하기]를 눌러야 풀리도록 잠금
            saveBtn.style.cursor = "not-allowed";

            asm.savedAt = new Date();
            await docRef.update({ assessments: assessments });
        }
    } catch(e) { 
        alert("업데이트 실패: " + e.message); 
        saveBtn.innerHTML = "💾 결과 저장하기";
        saveBtn.style.background = "#ef4444";
        saveBtn.disabled = false;
        saveBtn.style.cursor = "pointer";
    }
}

// 💡 [수정하기] 입력칸 잠금 해제 및 저장 버튼 빨간색으로 변경
function enableMEditMode() {
    // 1. 기존 기능: 입력칸 활성화
    document.querySelectorAll('.pct-input').forEach(input => {
        input.disabled = false;
        input.style.background = "white"; // 흰색 배경 복구
    });
    
    // 2. 기존 기능: 저장 버튼 활성화
    const saveBtn = document.getElementById('btn-save-m');
    if (saveBtn) {
        saveBtn.innerHTML = "💾 결과 저장하기";
        saveBtn.style.background = "#ef4444"; // 빨간색으로 돌아옴
        saveBtn.disabled = false;
        saveBtn.style.cursor = "pointer";
    }

    // 3. 🟢 추가된 기능: 누르자마자 즉시 '대기' 상태창으로 변경
    if (typeof cachedAsmData !== 'undefined' && typeof cachedProjectData !== 'undefined') {
        const myEmail = auth.currentUser.email;
        
        // 내 점수 데이터를 화면 갱신용으로만 임시 삭제 (DB 삭제 아님)
        if (cachedAsmData.teacherCutScores && cachedAsmData.teacherCutScores[myEmail]) {
            delete cachedAsmData.teacherCutScores[myEmail]; 
        }
        
        // 새로 만든 통합 함수를 불러와서 상태창 업데이트
        if (typeof updateMTableStatus === 'function') {
            updateMTableStatus(cachedAsmData, cachedProjectData);
        }
    }
}

// 💡 [초기화] 화면 내용 삭제 + DB 삭제하여 완벽한 '대기 중' 상태로 복귀
async function resetMCutScores() {
    if(!confirm("입력된 모든 비율(%) 내용을 삭제하고 빈칸으로 초기화하시겠습니까?\n(폴더 내 최종 산출 점수도 지워지며 '대기 중' 상태로 돌아갑니다.)")) return;
    
    // 1. 화면의 모든 입력칸 완전히 비우기 및 잠금 해제
    document.querySelectorAll('.pct-input').forEach(input => {
        input.value = ''; 
        input.style.backgroundImage = 'none'; 
        input.disabled = false; 

        // 🌟 [핵심 수정] 기존의 배경색이 노란색(fef08a 계열)인지 확인하고, 노란색이 아닐 때만 흰색으로 바꿉니다!
        const currentColor = input.style.backgroundColor;
        if (currentColor === 'rgb(254, 240, 138)' || currentColor.includes('#fef08a')) {
            // 노란색 칸은 뼈대이므로 배경색과 테두리를 유지합니다.
            input.style.border = '2px solid #eab308'; 
        } else {
            // 일반 칸들만 다시 흰색으로 깔끔하게 지웁니다.
            input.style.background = "white";
            input.style.border = '1px solid #cbd5e1'; 
        }
    });
    calculateTotalCutScores();
    
    // 2. 결과 저장하기 버튼을 다시 '빨간색' 기본 상태로 복귀
    const saveBtn = document.getElementById('btn-save-m');
    if (saveBtn) {
        saveBtn.innerHTML = "💾 결과 저장하기";
        saveBtn.style.background = "#ef4444"; 
        saveBtn.disabled = false;
        saveBtn.style.cursor = "pointer";
    }
    
    // 3. DB 비우기 및 빈칸 강제 저장
    if (!currentProjectId || currentEditingAssessmentIndex === -1) return;
    try {
        const docRef = db.collection('user_projects').doc(currentProjectId);
        const doc = await docRef.get();
        if(doc.exists) {
            let assessments = doc.data().assessments;
            let asm = assessments[currentEditingAssessmentIndex];
            const myEmail = auth.currentUser.email;
            
            if (asm.teacherCutScores && asm.teacherCutScores[myEmail]) delete asm.teacherCutScores[myEmail];
            if (asm.scores) delete asm.scores; // 폴더 내 최종점수 삭체 (산출전으로 복귀)
            
            // 💡 [핵심] 새로고침 시에도 '기본숫자'가 아닌 '빈칸'이 뜨도록 빈 배열을 덮어씀!
            let emptyTable = [];
            for(let i=0; i<6; i++) { emptyTable.push({A:'', B:'', C:'', D:'', E:''}); }
            if (!asm.teacherMTable) asm.teacherMTable = {};
            asm.teacherMTable[myEmail] = emptyTable;
            
            await docRef.update({ assessments: assessments });
            
            // 4. 왼쪽 상태창 UI 대기 상태로 변경 (새로고침 없이 부드럽게)
            const infoZone = document.getElementById('current-assessment-info');
            const compareBtn = document.getElementById('btn-compare-m');
            const examTitle = `${asm.name || '평가명 없음'} (${asm.weight || 0}%)`;

            let allMembers = doc.data().collaborators || [];
            if (doc.data().ownerEmail && !allMembers.includes(doc.data().ownerEmail)) allMembers.unshift(doc.data().ownerEmail);
            if (!allMembers.includes(myEmail)) allMembers.push(myEmail);
            const collaborators = [...new Set(allMembers)];

            let statusHTML = `<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;">`;
            collaborators.forEach(email => {
                const name = email.split('@')[0];
                if (asm.teacherCutScores && asm.teacherCutScores[email]) {
                    statusHTML += `<span style="background: #dcfce7; color: #166534; padding: 4px 8px; border-radius: 4px; border: 1px solid #86efac; font-size: 0.8rem; font-weight: bold;">✅ ${name}: 완료</span>`;
                } else {
                    statusHTML += `<span style="background: #f1f5f9; color: #64748b; padding: 4px 8px; border-radius: 4px; border: 1px solid #e2e8f0; font-size: 0.8rem; font-weight: bold;">⏳ ${name}: 대기</span>`;
                }
            });
            statusHTML += `</div>`;

            if (infoZone) {
                infoZone.innerHTML = `<div style="color:#1e3a8a; font-size:1.1rem; font-weight:900; margin-bottom:5px;">📌 ${examTitle}</div>` +
                                     `<div style="color:#334155; font-size:0.9rem; font-weight:bold;">👥 교사별 산출 저장 현황 <span style="color:#ef4444; font-size:0.85rem; margin-left:5px;">(초기화 됨)</span></div>` + statusHTML;
                infoZone.style.background = "#f8fafc"; infoZone.style.border = "1px solid #cbd5e1";
            }
            if (compareBtn) {
                compareBtn.disabled = true; compareBtn.style.background = "#94a3b8"; compareBtn.style.cursor = "not-allowed"; compareBtn.innerHTML = "📊 비교하기 (대기)";
            }
        }
    } catch(e) {
        console.error("초기화 에러: ", e);
    }
}

window.onload = async () => {
    // 1. DB 다운로드 대기 (이미 끝났으면 즉시 통과)
    if (!isDbLoaded && dbLoadPromise) {
        await dbLoadPromise; 
    }
    
    // 2. ✨ 일반 교사는 onAuthStateChanged에서 이미 본인 과목을 띄웠으므로 건드리지 않습니다.
    // 아직 로그인을 안 한 손님(guest)이거나 관리자(admin)일 때만 '수학'을 기본 탭으로 켭니다.
    if (currentUserRole === 'guest' || currentUserRole === 'admin') {
        changeGroup('math');         
    }
    
    syncPendingFeedback();       
    syncPendingVariants(); // 👈 [이 줄이 핵심입니다!] 접속 시 묵묵히 밀린 데이터를 DB로 밀어 넣습니다.
    
    initChatResizer(); 
    initCaptureEvents(); 
    initAdminDropdowns();
    initDictionaryDrag();

    const uploadArea = document.getElementById('upload-area');
    if (uploadArea) {
        uploadArea.addEventListener('paste', handlePaste);
        uploadArea.setAttribute('tabindex', '0'); 
    }
};

async function saveWrittenAssessmentShell() {
    const name = document.getElementById('written-assess-name').value.trim();
    const weight = parseFloat(document.getElementById('written-assess-weight').value) || 0;

    if(!name || weight <= 0) { alert("평가명과 반영 비율을 정확히 입력하세요."); return; }

    try {
        await db.collection('user_projects').doc(currentProjectId).update({
            assessments: firebase.firestore.FieldValue.arrayUnion({
                name: name, weight: weight, type: 'written',
                scores: { A: 0, B: 0, C: 0, D: 0, E: 0 },
                savedAt: new Date()
            })
        });
        alert("✅ 지필평가 항목이 생성되었습니다. 목록에서 '산출/수정'을 눌러 분석을 시작하세요.");
        document.getElementById('written-assess-name').value = '';
        document.getElementById('written-assess-weight').value = '';
        document.getElementById('written-assessment-modal').style.display = 'none';
        loadProjectDetails(); 
    } catch(err) { alert("생성 실패: " + err.message); }
}

let unsubscribeProject = null; 
// 🟢 [신규 추가] AI 판정결과 블라인드 기능 상태값 및 실시간 화면 갱신용 캐시 저장소
let isAiHidden = false;
let cachedProjectData = null;
let cachedAsmData = null;

// 🟢 [신규 추가] AI 판정 결과를 가리거나 보여주는 토글 함수
function toggleAiVisibility() {
    isAiHidden = !isAiHidden;
    if (cachedProjectData && cachedAsmData) {
        renderCollaborativeTable(cachedProjectData, cachedAsmData);
    }
}

// 💡 [완벽 교체] 텍스트 입력창을 하위 메뉴로 숨겨서 가장 심플한 동선을 만든 모달창
window.addManualTableQuestion = function() {
    let modal = document.getElementById('manual-q-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'manual-q-modal';
        modal.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:10000; display:flex; justify-content:center; align-items:center;";
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div style="background:white; width:90%; max-width:650px; border-radius:10px; padding:25px; box-shadow:0 10px 25px rgba(0,0,0,0.2); max-height:90vh; overflow-y:auto;">
            <h3 style="margin-top:0; color:#1e3a8a; border-bottom:2px solid #bfdbfe; padding-bottom:10px;">➕ 문항 수동 추가 및 편집</h3>
            
            <div style="display:flex; gap:10px; margin-bottom:20px;">
                <input type="text" id="mq-num" placeholder="문항 번호 (예: 14 또는 서1)" style="flex:1; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-weight:bold;">
                <input type="number" step="0.1" id="mq-score" placeholder="배점 (예: 4.5)" style="flex:1; padding:10px; border:1px solid #cbd5e1; border-radius:6px;">
            </div>
            
            <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; margin-bottom:20px;">
                <div onclick="document.getElementById('mq-ai-submenu').style.display = document.getElementById('mq-ai-submenu').style.display === 'none' ? 'block' : 'none';" 
                     style="padding:15px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; background:#f1f5f9; border-radius:6px;">
                    <strong style="color:#065f46; font-size:1.05rem;">🤖 상세 내용 입력 및 AI 판정 (선택) 🔽</strong>
                    <span style="font-size:0.8rem; color:#64748b;">클릭하여 열기/접기</span>
                </div>
                
                <div id="mq-ai-submenu" style="display:none; padding:15px; border-top:1px solid #cbd5e1;">
                    
                    <div style="text-align:center; margin-bottom:15px; border-bottom:1px dashed #cbd5e1; padding-bottom:15px;">
                        <p style="margin:0 0 10px 0; font-size:0.85rem; color:#64748b;">💡 화면에서 [Win + Shift + S]로 문항을 캡처하신 후 아래 버튼을 누르세요.</p>
                        <button onclick="pasteImageToManualModal()" style="background:#fef3c7; color:#92400e; border:1px solid #fde68a; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:bold; box-shadow:0 2px 4px rgba(0,0,0,0.05);">📋 복사한 그림 붙여넣기 (Ctrl+V)</button>
                        
                        <div id="mq-image-preview" style="margin-top:15px; display:none;">
                            <img id="mq-img" src="" style="max-width:100%; max-height:200px; border:1px solid #cbd5e1; border-radius:6px;">
                            <button onclick="removeManualImage()" style="display:block; margin:8px auto 0 auto; background:#fee2e2; color:#ef4444; border:none; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:0.8rem; font-weight:bold;">❌ 그림 지우기</button>
                        </div>
                    </div>

                    <div style="font-size:0.85rem; font-weight:bold; color:#334155; margin-bottom:5px;">📝 문항 내용 (텍스트)</div>
                    <textarea id="mq-text" placeholder="직접 타자로 입력하시거나, 아래의 [AI 개별 분석]을 돌리면 자동으로 텍스트가 채워집니다." style="width:100%; height:80px; padding:10px; border:1px solid #cbd5e1; border-radius:6px; margin-bottom:15px; font-family:inherit; box-sizing:border-box; line-height:1.5;"></textarea>

                    <button onclick="runManualSingleAI()" id="mq-ai-btn" style="background:#10b981; color:white; border:none; padding:10px 16px; border-radius:6px; cursor:pointer; font-weight:bold; box-shadow:0 2px 4px rgba(0,0,0,0.1); transition:0.2s; width:100%;">✨ 첨부한 이미지로 개별 분석하기</button>

                    <div id="mq-ai-result-area" style="display:none; margin-top:15px; background:#ecfdf5; padding:15px; border:1px solid #a7f3d0; border-radius:6px;">
                        <div style="font-size:0.85rem; font-weight:bold; color:#065f46; margin-bottom:8px;">📊 AI 수준 및 판정 이유 (수정 불가)</div>
                        <div style="display:flex; gap:10px;">
                            <input type="text" id="mq-level" placeholder="수준" style="width:70px; padding:8px; border:1px solid #cbd5e1; border-radius:6px; text-align:center; font-weight:bold; color:#475569; background:#e2e8f0; cursor:not-allowed;" readonly>
                            <input type="text" id="mq-reason" placeholder="AI 판정 이유" style="flex:1; padding:8px; border:1px solid #cbd5e1; border-radius:6px; color:#475569; background:#e2e8f0; cursor:not-allowed;" readonly>
                        </div>
                        <p style="margin:8px 0 0 0; font-size:0.75rem; color:#047857; text-align:center;">💡 추출된 텍스트는 바로 위 [문항 내용] 칸에 자동 입력되었습니다.</p>
                    </div>
                </div>
            </div>

            <div style="display:flex; justify-content:flex-end; gap:10px;">
                <button onclick="document.getElementById('manual-q-modal').style.display='none'" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; padding:10px 20px; border-radius:6px; cursor:pointer; font-weight:bold;">취소</button>
                <button onclick="saveManualQuestionToDB()" style="background:#2563eb; color:white; border:none; padding:10px 20px; border-radius:6px; cursor:pointer; font-weight:bold; box-shadow:0 4px 6px rgba(0,0,0,0.2);">💾 채점표에 저장하기</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
};

// 💡 붙여넣기 도우미 함수들
window.pasteImageToManualModal = async function() {
    try {
        const clipboardItems = await navigator.clipboard.read();
        for (const item of clipboardItems) {
            const imageTypes = item.types.filter(type => type.startsWith('image/'));
            if (imageTypes.length > 0) {
                const blob = await item.getType(imageTypes[0]);
                const reader = new FileReader();
                reader.onload = (e) => {
                    document.getElementById('mq-img').src = e.target.result;
                    document.getElementById('mq-image-preview').style.display = 'block';
                };
                reader.readAsDataURL(blob);
                return;
            }
        }
        alert("⚠️ 복사된 그림이 없습니다. 먼저 화면을 캡처(Win+Shift+S)해 주세요!");
    } catch(err) {
        alert("🚨 그림 붙여넣기 권한(클립보드 접근)을 허용해 주세요.");
    }
};

window.removeManualImage = function() {
    document.getElementById('mq-img').src = "";
    document.getElementById('mq-image-preview').style.display = 'none';
};

// 💡 [핵심] 단 1개의 문제만 핀셋으로 읽어내는 초고속 AI 호출 함수
window.runManualSingleAI = async function() {
    const imgSrc = document.getElementById('mq-img').src;
    if (!imgSrc || !imgSrc.startsWith('data:image')) {
        alert("💡 AI 판정을 받으려면 먼저 문항 영역을 캡처해서 붙여넣어 주세요!\n(AI가 그림 속의 문제와 도표를 모두 읽어냅니다.)");
        return;
    }

    const btn = document.getElementById('mq-ai-btn');
    const originalText = btn.innerText;
    btn.innerText = "⏳ AI가 문항을 분석 중입니다..."; btn.disabled = true;

    try {
        const match = imgSrc.match(/data:(.*?);base64/);
        const mimeType = match ? match[1] : "image/jpeg";
        const base64Clean = imgSrc.split(',')[1];
        
        const referenceDBText = typeof fetchReferenceQuestions === 'function' ? await fetchReferenceQuestions(currentSubject) : "";
        const workerUrl = "https://script.google.com/macros/s/AKfycbwgx4RgF8FQxxL3jBgEQ5l369llADjhZ1NepulIdF4DdX18kBrB8oRQ4Ft0d5WdKtEF/exec";
        const userApiKey = localStorage.getItem('gemini_api_key');

        const response = await fetch(workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: "exam_analysis",
                mimeType: mimeType,
                base64Clean: base64Clean,
                referenceDBText: referenceDBText,
                subject: typeof currentSubject !== 'undefined' ? currentSubject : "uncategorized",
                isExtractAll: true, 
                apiKey: userApiKey
            })
        });

        const data = await response.json();
        if (data.error) throw new Error(data.error.message);

        const fullText = data.candidates[0].content.parts[0].text;
        
        // AI 데이터 발라내기
        let levelMatch = fullText.match(/\[수준\]\s*(A\+|[A-E])/);
        let reasonMatch = fullText.match(/\[이유\]\s*([^|]+)/);
        let contentMatch = fullText.match(/\[문항내용\]\s*([\s\S]*)/);

        // 💡 AI 결과를 잠겨있는(readonly) 입력창에 뿌려주고 숨겨진 구역을 짠! 하고 보여줍니다.
        if (levelMatch) document.getElementById('mq-level').value = levelMatch[1].trim();
        if (reasonMatch) document.getElementById('mq-reason').value = reasonMatch[1].trim();
        document.getElementById('mq-ai-result-area').style.display = 'block';
        
        // 문항 텍스트 추출 결과는 맨 위쪽 텍스트창에 채워줍니다. (텍스트는 교사가 수정할 수 있게 유지)
        if (contentMatch && !document.getElementById('mq-text').value) {
            document.getElementById('mq-text').value = contentMatch[1].trim();
        }

        alert("✨ AI 분석이 완료되었습니다!\n추출된 결과는 회색 칸에 고정되어 수정할 수 없습니다.");

    } catch(e) {
        alert("AI 판정 중 오류가 발생했습니다: " + e.message);
    } finally {
        btn.innerText = originalText; btn.disabled = false;
    }
};

// 💡 채점표와 보조 서랍(이미지 및 텍스트)에 동시 저장하는 함수
window.saveManualQuestionToDB = async function() {
    const qNum = document.getElementById('mq-num').value.trim();
    const score = parseFloat(document.getElementById('mq-score').value) || 0;
    const text = document.getElementById('mq-text').value.trim();
    const level = document.getElementById('mq-level') ? document.getElementById('mq-level').value.trim() : "판정필요";
    const reason = document.getElementById('mq-reason') ? document.getElementById('mq-reason').value.trim() : "수동으로 추가/수정된 문항입니다.";
    const imgSrc = document.getElementById('mq-img') ? document.getElementById('mq-img').src : null;
    
    if (!qNum) { alert("문항 번호를 반드시 입력해주세요!"); return; }

    const btn = document.querySelector('#manual-q-modal button[onclick="saveManualQuestionToDB()"]');
    btn.innerText = "⏳ 저장 중..."; btn.disabled = true;

    try {
        const docRef = db.collection('user_projects').doc(currentProjectId);
        const projectDoc = await docRef.get();
        if (!projectDoc.exists) throw new Error("프로젝트를 찾을 수 없습니다.");
        
        const projectData = projectDoc.data();
        const ownerEmail = projectData.ownerEmail || "";
        const collaborators = projectData.collaborators || [];
        const userNickname = auth.currentUser ? (auth.currentUser.displayName || "선생님") : "알 수 없음";

        // 1. 이미지는 용량이 크므로 기존처럼 개별 문서로 안전하게 분리 저장
        let finalImageId = null;
        if (imgSrc && imgSrc.startsWith('data:image')) {
            let compressedBase64 = await new Promise(resolve => compressCaptureImage(imgSrc, resolve));
            const imgDocRef = await db.collection('project_images').add({
                projectId: currentProjectId,
                assessmentIndex: currentEditingAssessmentIndex,
                questionNum: qNum,
                base64Data: compressedBase64,
                ownerEmail: ownerEmail,
                collaborators: collaborators,
                userNickname: userNickname,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });
            finalImageId = imgDocRef.id;
        }

        // 2. 🌟 텍스트는 프로젝트 전용 '통합 문서 1개'에 업데이트 (쓰레기 데이터 미생성, 덮어쓰기)
        let textPreview = ""; 
        if (text) {
            const masterTextRef = db.collection('project_texts').doc(currentProjectId);
            // 특정 문항(예: texts.asm0_q1)의 방에만 데이터를 업데이트 (merge: true로 다른 문항 보호)
            await masterTextRef.set({
                projectId: currentProjectId,
                ownerEmail: ownerEmail,
                collaborators: collaborators,
                userNickname: userNickname,
                [`texts.asm${currentEditingAssessmentIndex}_q${qNum}`]: text,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true }); 
            
            textPreview = text.length > 30 ? text.substring(0, 30) + "..." : text;
        }

        // 3. 메인 문서 업데이트 (안전한 트랜잭션)
        await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(docRef);
            let assessments = doc.data().assessments;
            let asm = assessments[currentEditingAssessmentIndex];
            let baseScores = asm.parsedScores || [];
            
            let existingIdx = baseScores.findIndex(q => String(q.num).trim() === qNum);
            const isShort = qNum.includes('서') || qNum.startsWith('서');

            const newQData = {
                num: qNum, score: score, difficulty: "", level: level || "판정필요",
                isShortAnswer: isShort, reason: reason || "수동으로 추가/수정된 문항입니다.", 
                text: textPreview // 뷰어용 미리보기만 남김 (textId는 통합되었으므로 불필요)
            };

            if (finalImageId) newQData.imageId = finalImageId;

            if (existingIdx !== -1) {
                let oldData = baseScores[existingIdx];
                // 기존 이미지 유지 로직
                if (!finalImageId && oldData.imageId) newQData.imageId = oldData.imageId;
                // 기존 텍스트 유지 로직 (새로 입력한 text가 없을 때)
                if (!text && oldData.text) newQData.text = oldData.text; 
                
                baseScores[existingIdx] = { ...oldData, ...newQData };
            } else {
                baseScores.push(newQData);
            }

            // 정렬 로직 유지
            baseScores.sort((a, b) => {
                const aIsShort = String(a.num).startsWith('서'); const bIsShort = String(b.num).startsWith('서');
                if (aIsShort && !bIsShort) return 1; if (!aIsShort && bIsShort) return -1;
                return (parseInt(String(a.num).replace(/[^0-9]/g, '')) || 0) - (parseInt(String(b.num).replace(/[^0-9]/g, '')) || 0);
            });
            
            asm.parsedScores = baseScores;
            transaction.update(docRef, { assessments: assessments });
        });

        document.getElementById('manual-q-modal').style.display = 'none';
        alert(`✅ ${qNum}번 문항이 완벽하게 반영되었습니다!`);
    } catch(e) { alert("저장 실패: " + e.message); } 
    finally { btn.innerText = "💾 채점표에 저장하기"; btn.disabled = false; }
};

// ✨ [신규 추가] 저장된 데이터를 기반으로 표를 다시 그려주는 함수
function restoreScoreTable(savedScores) {
    const container = document.getElementById('score-table-container');
    let html = `<table class="score-table">
                <thead style="position: sticky; top: 0; background: #f1f5f9; z-index: 1;">
                <tr><th>문항 번호</th><th>예상 난이도</th><th>배점 (점)</th><th>예상 성취수준</th></tr></thead><tbody>`;

    savedScores.forEach(q => {
        const isShort = String(q.num).includes('서');
        const diff = q.difficulty || '중';
        const level = q.level || 'C';

        html += `<tr ${isShort ? 'style="background:#fff7ed;"' : ''}>
            <td>${q.num}</td>
            <td>
                <select class="diff-select" style="padding:4px; border-radius:4px;">
                    <option value="상" ${diff==='상'?'selected':''}>상 (어려움)</option>
                    <option value="중" ${diff==='중'?'selected':''}>중 (보통)</option>
                    <option value="하" ${diff==='하'?'selected':''}>하 (쉬움)</option>
                </select>
            </td>
            <td><input type="number" step="0.1" class="score-input" data-num="${q.num}" value="${q.score}" oninput="updateStep2Total()"></td>
            <td><select class="level-select" style="padding:4px;">
                <option value="A" ${level==='A'?'selected':''}>A</option>
                <option value="B" ${level==='B'?'selected':''}>B</option>
                <option value="C" ${level==='C'?'selected':''}>C</option>
                <option value="D" ${level==='D'?'selected':''}>D</option>
                <option value="E" ${level==='E'?'selected':''}>E</option>
            </select></td>
        </tr>`;
    });
    html += `</tbody></table>`;
    container.innerHTML = html;
    updateStep2Total();
    
    // 전역 변수 동기화
    parsedScores = savedScores;
}
// 🟢 [추가] AI 도우미 영역 열기/닫기
function openAiHelper() {
    const zone = document.getElementById('ai-helper-zone');
    zone.style.display = zone.style.display === 'none' ? 'block' : 'none';
}
// 🟢 [완벽 수정] 브라우저 뒤로가기 제어 로직 (CCTV 스마트 스위칭 포함)
window.addEventListener('popstate', function(event) {
    document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    if (event.state && event.state.section) {
        const targetSection = document.getElementById(event.state.section);
        if(targetSection) targetSection.classList.add('active');

        // 분할점수(cut-score) 내부 라우팅 처리
        if(event.state.section === 'cut-score') {
            document.querySelectorAll('.cut-score-card').forEach(card => card.style.display = 'none');
            
            if (event.state.sub === 'project-detail') {
                // [프로젝트 상세 화면으로 복귀]
                document.getElementById('project-detail-view').style.display = 'block';

                // 💡 [CCTV 최적화] 지필평가 상세 창에서 뒤로가기로 나왔으므로, 지필용 감시 전원을 뽑습니다.
                if (typeof unsubscribeProject !== 'undefined' && unsubscribeProject) {
                    unsubscribeProject();
                    unsubscribeProject = null;
                }
                // 💡 폴더 화면으로 돌아왔으므로 폴더용 감시를 다시 켭니다.
                if (currentProjectId && typeof loadProjectDetails === 'function') {
                    loadProjectDetails();
                }

            } else if (event.state.sub === 'step2') {
                // 표 작성 화면으로 복귀
                document.getElementById('cut-score-step2').style.display = 'block';
            } else {
                // 폴더 대시보드로 복귀
                document.getElementById('cut-score-dashboard').style.display = 'block';
            }
        }
    } else {
        // 초기 화면으로 돌아왔을 때 기본 대시보드 띄우기
        document.getElementById('dashboard').classList.add('active');
    }
});

async function sendAiResultsToTable(isFromSaveBank = false) {
    if (!isFromSaveBank) {
        if (!confirm("추출한 문항을 표에 반영하시겠습니까?\n(취소를 누르면 이전 화면으로 멈춰있습니다.)")) return;
    }

    if (extractedQuestionsArray.length === 0) { alert("분석된 문항이 없습니다."); return; }

    // 1. 화면의 입력값(번호, 텍스트)을 배열에 최신화
    extractedQuestionsArray.forEach((q, idx) => {
        const numInput = document.querySelector(`input[oninput*="extractedQuestionsArray[${idx}].num"]`);
        if (numInput) q.num = numInput.value;

        const textInput = document.querySelectorAll('.q-edit-area')[idx];
        if (textInput) q.text = textInput.value;
    });

    const btn = document.querySelector('button[onclick="sendAiResultsToTable()"]');
    const originalBtnText = btn ? btn.innerText : "🗑️ 저장하지 않고 표에만 반영";
    if(btn) {
        btn.innerText = "⏳ 표에 반영 중...";
        btn.disabled = true;
    }

    const ownerEmail = auth.currentUser ? auth.currentUser.email : "알 수 없음";
    const userNickname = auth.currentUser ? (auth.currentUser.displayName || "선생님") : "알 수 없음";

    // 💡 2. 새로운 서랍(project_images)에 이미지만 분리해서 저장
    const processedQuestions = [];
    for (let i = 0; i < extractedQuestionsArray.length; i++) {
        let q = extractedQuestionsArray[i];
        let finalImageId = null;

        if (q.image) {
            // 이미지 압축
            let compressedBase64 = await new Promise(resolve => {
                compressCaptureImage(q.image, (compressed) => resolve(compressed));
            });

            // 새로운 보조 서랍(project_images)에 저장하고 '문서 열쇠(ID)' 받기
            try {
                const imgDocRef = await db.collection('project_images').add({
                    projectId: currentProjectId,
                    assessmentIndex: currentEditingAssessmentIndex,
                    questionNum: q.num,
                    base64Data: compressedBase64,
                    ownerEmail: ownerEmail,
                    userNickname: userNickname,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
                finalImageId = imgDocRef.id; // 🔑 이미지를 찾을 수 있는 열쇠 획득!
            } catch (err) {
                console.error("이미지 분리 저장 실패:", err);
            }
        }

        processedQuestions.push({ 
            ...q, 
            imageId: finalImageId // 무거운 image 대신 가벼운 imageId만 갖게 됨
        });
    }

    // 💡 3. [텍스트 분리 로직] 텍스트를 project_texts 통합 문서에 일괄 병합 저장
    const textsToUpdate = {};
    processedQuestions.forEach((q) => {
        if (q.text) {
            // "texts.asm0_q1" 같은 형식으로 맵핑하여 누적 저장
            textsToUpdate[`texts.asm${currentEditingAssessmentIndex}_q${q.num}`] = q.text;
        }
    });

    if (Object.keys(textsToUpdate).length > 0) {
        try {
            await db.collection('project_texts').doc(currentProjectId).set({
                projectId: currentProjectId,
                ownerEmail: ownerEmail,
                userNickname: userNickname,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                ...textsToUpdate
            }, { merge: true }); // merge: true로 기존 데이터를 안전하게 보존
        } catch (err) {
            console.error("통합 텍스트 저장 실패:", err);
        }
    }

    // 💡 4. user_projects 문서 업데이트 (텍스트와 이미지는 완전히 비우고 열쇠만 저장)
    try {
        const docRef = db.collection('user_projects').doc(currentProjectId);
        
        await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(docRef);
            if(!doc.exists) throw new Error("문서를 찾을 수 없습니다.");
            
            let assessments = doc.data().assessments;
            let asm = assessments[currentEditingAssessmentIndex];
            let baseScores = asm.parsedScores || []; 

            processedQuestions.forEach((q, idx) => {
                let diffSelect = document.getElementById(`ai-diff-${idx}`);
                let diff = (diffSelect && diffSelect.value !== "") ? diffSelect.value : "";
                let isShort = String(q.num).includes('서') || String(q.num).startsWith('서');

                let existingIdx = baseScores.findIndex(s => String(s.num).trim() === String(q.num).trim());

                if (existingIdx !== -1) {
                    baseScores[existingIdx].score = parseFloat(q.score) || 0;
                    if(diff !== "") baseScores[existingIdx].difficulty = diff;
                    baseScores[existingIdx].isShortAnswer = isShort; 
                    baseScores[existingIdx].level = q.level || "판정필요";
                    baseScores[existingIdx].reason = q.reason || "";
                    
                    // 🌟 무거운 데이터(원문 텍스트, 원본 이미지) 완전 제거 보장
                    baseScores[existingIdx].text = ""; // 미리보기도 없이 완전히 비움!
                    delete baseScores[existingIdx].image; // 만약 기존에 남아있는 원본 이미지가 있다면 삭제
                    
                    if (q.imageId) baseScores[existingIdx].imageId = q.imageId; 
                } else {
                    baseScores.push({ 
                        num: String(q.num).trim(), 
                        score: parseFloat(q.score) || 0, 
                        difficulty: diff || "", 
                        level: q.level || "판정필요",
                        isShortAnswer: isShort,
                        reason: q.reason || "",
                        text: "", // 🌟 텍스트 완전 비움 (project_texts에서 불러옴)
                        imageId: q.imageId || null
                    });
                }
            });

            // 번호순 정렬
            baseScores.sort((a, b) => {
                const aIsShort = String(a.num).startsWith('서');
                const bIsShort = String(b.num).startsWith('서');
                if (aIsShort && !bIsShort) return 1;
                if (!aIsShort && bIsShort) return -1;

                let aNum = parseInt(a.num.replace(/[^0-9]/g, '')) || 0;
                let bNum = parseInt(b.num.replace(/[^0-9]/g, '')) || 0;
                return aNum - bNum;
            });

            assessments[currentEditingAssessmentIndex].parsedScores = baseScores;
            if (currentUploadedImageUrl) {
                assessments[currentEditingAssessmentIndex].imageUrl = currentUploadedImageUrl; 
            }

            transaction.update(docRef, { assessments: assessments });
        });
        
        alert("✅ 표 반영 성공! (문항 데이터 경량화 분리 완료)");

        extractedQuestionsArray = []; 
        renderQuestionCards(); 
        
        const applyBtnContainer = document.getElementById('external-apply-btn-zone');
        if (applyBtnContainer) applyBtnContainer.style.display = 'none';

        const wrapper = document.getElementById('exam-inspector-wrapper');
        const toggleBtn = document.getElementById('exam-viewer-toggle-btn');
        if (wrapper) {
            wrapper.style.display = 'none';
            if (toggleBtn) toggleBtn.innerText = "📄 시험지 파일 및 편집 확인 🔽";
        }
        
    } catch(e) { 
        alert("반영 실패: " + e.message); 
    } finally {
        if(btn) {
            btn.innerText = originalBtnText;
            btn.disabled = false;
        }
    }
}

// 8번 해결: 지필/수행 키워드 확장 및 최신순 정렬
async function renderSavedAssessments() {
    const listContainer = document.getElementById('saved-assessment-list');
    if(!listContainer) return;

    listContainer.innerHTML = "<p style='padding:10px; color:#64748b;'>목록을 불러오는 중...</p>";
    if (!auth.currentUser) {
        listContainer.innerHTML = "<p style='padding:10px; color:#ef4444;'>로그인이 필요합니다.</p>";
        return;
    }

    try {
        const snapshot = await db.collection("assessments")
                                 .where("uid", "==", auth.currentUser.uid)
                                 .orderBy("createdAt", "desc")
                                 .get();

        if (snapshot.empty) {
            listContainer.innerHTML = "<p style='padding:10px;'>저장된 평가가 없습니다.</p>";
            return;
        }

        // 💡 [지능형 정렬 로직]
        const docsArray = snapshot.docs.sort((a, b) => {
            const dataA = a.data();
            const dataB = b.data();
            const titleA = dataA.title || "";
            const titleB = dataB.title || "";

            // 지필고사로 판단할 키워드들 (선생님이 쓰시는 단어들 추가)
            const jipilKeywords = ["지필", "1회", "2회", "중간", "기말", "고사"];
            const isA_Jipil = jipilKeywords.some(k => titleA.includes(k));
            const isB_Jipil = jipilKeywords.some(k => titleB.includes(k));

            // 1. 카테고리 우선 정렬 (지필이 위로)
            if (isA_Jipil && !isB_Jipil) return -1;
            if (!isA_Jipil && isB_Jipil) return 1;

            // 2. 같은 카테고리 내에서는 최신 날짜가 위로 (내림차순)
            const dateA = dataA.createdAt ? dataA.createdAt.toMillis() : 0;
            const dateB = dataB.createdAt ? dataB.createdAt.toMillis() : 0;
            return dateB - dateA; 
        });

        let html = `<ul style="list-style:none; padding:0; margin:0;">`;
        docsArray.forEach(doc => {
            const data = doc.data();
            const date = data.createdAt ? new Date(data.createdAt.toMillis()).toLocaleString() : "날짜 없음";
            
            // 지필은 파란색, 수행은 초록색으로 시각적 구분
            const isJipil = ["지필", "1회", "2회", "중간", "기말", "고사"].some(k => data.title.includes(k));
            const themeColor = isJipil ? "#3b82f6" : "#10b981";
            const tagText = isJipil ? "지필" : "수행";

            html += `
                <li style="margin-bottom: 10px; padding: 12px; border: 1px solid #e2e8f0; border-left: 6px solid ${themeColor}; border-radius: 6px; background: white; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span style="background:${themeColor}; color:white; font-size:0.7rem; padding:2px 6px; border-radius:4px; font-weight:bold;">${tagText}</span>
                            <div style="font-weight: bold; color: #0f172a; font-size: 1.05rem;">${data.title}</div>
                        </div>
                        <div style="font-size: 0.8rem; color: #64748b; margin-top: 4px; padding-left: 45px;">${date}</div>
                    </div>
                    <div style="display:flex; gap:6px;">
                        <button onclick="deleteAssessment('${doc.id}')" style="background:#fef2f2; color:#b91c1c; border:1px solid #fecaca; padding:6px 12px; border-radius:4px; cursor:pointer;">삭제</button>
                    </div>
                </li>
            `;
        });
        html += `</ul>`;
        listContainer.innerHTML = html;
        
    } catch (error) {
        console.error("정렬 로드 오류:", error);
        listContainer.innerHTML = "<p>목록 정렬 중 오류가 발생했습니다.</p>";
    }
}
// ✨ 캡처(복사)한 이미지를 해당 문항에 바로 붙여넣는 마법 함수
async function pasteImageToQuestion(idx) {
    try {
        // 클립보드(복사된 데이터) 읽기 권한 요청
        const clipboardItems = await navigator.clipboard.read();
        
        for (const clipboardItem of clipboardItems) {
            // 복사된 내용 중 이미지가 있는지 확인
            const imageTypes = clipboardItem.types.filter(type => type.startsWith('image/'));
            
            if (imageTypes.length > 0) {
                const blob = await clipboardItem.getType(imageTypes[0]);
                const reader = new FileReader();
                
                reader.onload = (e) => {
                    // 해당 문항의 데이터에 이미지 주소 넣기
                    extractedQuestionsArray[idx].image = e.target.result;
                    renderQuestionCards(); // 화면 새로고침
                    alert("✅ 그림이 성공적으로 첨부되었습니다!");
                };
                reader.readAsDataURL(blob);
                return; 
            }
        }
        // 사용자가 실수로 텍스트를 복사했거나, 복사를 안 했을 때의 친절한 안내
        alert("⚠️ 아직 복사된 그림이 없습니다.\n\n1. 왼쪽 화면에서 [윈도우키 + Shift + S]를 눌러 그림을 캡처하세요.\n2. 다시 이 [붙여넣기] 버튼을 눌러주세요!");
    } catch (err) {
        console.error("클립보드 접근 에러:", err);
        alert("🚨 그림을 가져올 수 없습니다.\n인터넷 주소창 왼쪽의 '자물쇠' 아이콘을 클릭하고 [클립보드] 권한을 '허용'으로 바꿔주세요.");
    }
}
// ✨ 다른 선생님을 폴더 공동 작업자로 초대하는 함수
// ✨ 다른 선생님을 폴더 공동 작업자로 초대하는 함수
async function inviteCollaborator(projectId, event) {
    event.stopPropagation(); // 버튼 눌렀을 때 폴더 안으로 안 들어가게 막아줌
    
    const email = prompt("🤝 함께 점수를 산출할 선생님의 구글 계정(이메일)을 정확히 입력하세요.");
    if (!email || email.trim() === "") return;
    
    try {
        const docRef = db.collection('user_projects').doc(projectId);
        const doc = await docRef.get();
        
        if (doc.exists) {
            let data = doc.data();
            let collabs = data.collaborators || [];
            
            // 이미 초대된 사람인지 확인
            if (collabs.includes(email.trim())) {
                alert("이미 초대된 선생님입니다.");
                return;
            }
            
            collabs.push(email.trim());
            let assessments = data.assessments || [];
            
            // 💡 [핵심] 선생님이 만드신 '난이도, 배점 연동 데이터(parsedScores)'는 절대 건드리지 않습니다!
            // 오직 폴더 밖의 '최종 합산 분할점수(scores)'만 지워서 산출 전 상태로 블라인드 처리합니다.
            assessments = assessments.map(asm => {
                if (asm.scores) {
                    delete asm.scores; // 최종 분할점수 결과만 삭제
                }
                return asm;
            });
            
            // DB에 초대 명단(collaborators)과 업데이트된 상태를 한 번에 저장
            await docRef.update({
                collaborators: collabs,
                assessments: assessments
            });
            
            alert(`✅ ${email} 선생님을 성공적으로 초대했습니다!\n\n초대받은 선생님이 로그인하시면 [분할점수 산출] 화면에 이 폴더가 나타납니다.\n(새로운 협의체가 구성되어 폴더 밖의 '최종 분할점수'는 블라인드 처리되었으나, 문항별 배점과 난이도 연동은 그대로 유지됩니다!)`);
            
            loadProjects(); // 화면 갱신해서 '👥 참여 교사: 2명' 등으로 업데이트
        }
    } catch (e) {
        alert("초대 중 오류가 발생했습니다: " + e.message);
    }
}
// 🚫 [수정됨] 팀원 강퇴 시 즉각적인 점수 재계산 및 유령 데이터 청소 기능 추가
async function kickFromProject(projectId, targetEmail, event) {
    event.stopPropagation(); 
    
    if (!confirm(`[${targetEmail.split('@')[0]}] 선생님을 이 프로젝트에서 정말로 제외하시겠습니까?\n제외 즉시 남은 인원 기준으로 최종 점수가 자동 재계산됩니다.`)) return;

    try {
        const docRef = db.collection('user_projects').doc(projectId);
        
        // 🔒 마법의 자물쇠(트랜잭션)를 걸어 DB를 안전하게 통째로 수술합니다.
        await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(docRef);
            if (!doc.exists) throw new Error("프로젝트를 찾을 수 없습니다.");
            
            let projectData = doc.data();
            let collabs = projectData.collaborators || [];
            
            // 1. 팀원 목록에서 해당 이메일 삭제
            collabs = collabs.filter(email => email !== targetEmail);
            
            let assessments = projectData.assessments || [];
            let ownerEmail = projectData.ownerEmail;
            
            // 2. 남은 '진짜' 유효 멤버 명단 만들기 (방장 + 남은 팀원) + 👻 유령 멤버 완벽 차단!
            let activeMembers = [...collabs];
            if (ownerEmail && !activeMembers.includes(ownerEmail)) activeMembers.unshift(ownerEmail);
            const uniqueMembers = [...new Set(activeMembers)].filter(Boolean); // 👈 빈 값(undefined) 완벽 차단

            // 3. 지필/수행평가 폴더를 싹 다 뒤지면서 점수 재계산 및 찌꺼기 청소
            assessments = assessments.map(asm => {
                
                // 🌟 [핵심 복구] 과거에 만들어진 수행평가 점수(레거시 데이터)가 날아가지 않도록 안전하게 마이그레이션
                if (asm.type === 'manual' && asm.scores && (!asm.teacherManualScores || Object.keys(asm.teacherManualScores).length === 0)) {
                    if (!asm.teacherManualScores) asm.teacherManualScores = {};
                    let ratio = asm.weight ? (asm.weight / 100) : 1;
                    // 과거 폴더를 만든 주인의 이메일로 점수 이관 (방장 이메일이 없으면 현재 사용자)
                    let targetHost = ownerEmail || auth.currentUser.email;
                    asm.teacherManualScores[targetHost] = {
                        A: Math.round(asm.scores.A / ratio),
                        B: Math.round(asm.scores.B / ratio),
                        C: Math.round(asm.scores.C / ratio),
                        D: Math.round(asm.scores.D / ratio),
                        E: Math.round(asm.scores.E / ratio)
                    };
                }

                // 🧹 [청소] 쫓겨난 팀원이 입력해둔 찌꺼기 점수와 판정 내역을 완전히 삭제합니다.
                if (asm.teacherCutScores && asm.teacherCutScores[targetEmail]) delete asm.teacherCutScores[targetEmail];
                if (asm.teacherMTable && asm.teacherMTable[targetEmail]) delete asm.teacherMTable[targetEmail];
                if (asm.teacherInputs && asm.teacherInputs[targetEmail]) delete asm.teacherInputs[targetEmail];
                if (asm.readyStatus && asm.readyStatus[targetEmail]) delete asm.readyStatus[targetEmail];
                if (asm.teacherManualScores && asm.teacherManualScores[targetEmail]) delete asm.teacherManualScores[targetEmail];
                if (asm.teacherManualStructures && asm.teacherManualStructures[targetEmail]) delete asm.teacherManualStructures[targetEmail];

                // 🔍 [검사] 남은 사람들이 모두 산출을 '완료'했는지 확인
                let missing = [];
                uniqueMembers.forEach(email => {
                    if (asm.type === 'written') {
                        if (!asm.teacherCutScores || !asm.teacherCutScores[email]) missing.push(email);
                    } else { // 수행평가일 때
                        if (!asm.teacherManualScores || !asm.teacherManualScores[email]) missing.push(email);
                    }
                });

                // ✨ [핵심: 점수 복구] 남은 인원이 모두 완료 상태라면 최종 점수 즉시 부활!
                if (missing.length === 0 && uniqueMembers.length > 0) {
                    let avg = { A: 0, B: 0, C: 0, D: 0, E: 0 };
                    let cnt = uniqueMembers.length;
                    let weight = asm.weight || 0;

                    // 남은 사람들의 점수만 모아서 더하기
                    uniqueMembers.forEach(email => {
                        let scoresObj = asm.type === 'written' ? asm.teacherCutScores[email] : asm.teacherManualScores[email];
                        if (scoresObj) {
                            avg.A += scoresObj.A; avg.B += scoresObj.B;
                            avg.C += scoresObj.C; avg.D += scoresObj.D; avg.E += scoresObj.E;
                        }
                    });

                    // 평균을 내서 비율을 곱한 진짜 최종 점수를 asm.scores에 꽂아 넣음!
                    asm.scores = {
                        A: (avg.A / cnt) * (weight / 100),
                        B: (avg.B / cnt) * (weight / 100),
                        C: (avg.C / cnt) * (weight / 100),
                        D: (avg.D / cnt) * (weight / 100),
                        E: (avg.E / cnt) * (weight / 100)
                    };
                } else {
                    // 남은 사람 중에도 아직 완료를 안 한 사람이 있다면 여전히 가려둡니다.
                    if (asm.scores) delete asm.scores;
                }

                return asm;
            });

            // 4. DB에 완벽히 정제된 데이터를 덮어쓰기
            transaction.update(docRef, {
                collaborators: collabs,
                assessments: assessments
            });
        });
        
        // 5. 완료 알림 및 대시보드 갱신
        alert("팀원이 제외되었으며, 최종 컷오프 점수가 남은 인원에 맞춰 완벽하게 재계산되었습니다.");
        loadProjects(); // 화면 1초 만에 새로고침!
        
    } catch (error) {
        alert("팀원 제외 및 점수 재계산에 실패했습니다: " + error.message);
    }
}

function renderCollaborativeTable(projectData, asm) {
    const container = document.getElementById('score-table-container');
    const currentUserEmail = auth.currentUser.email;
    
    let allMembers = projectData.collaborators || [];
    if (projectData.ownerEmail && !allMembers.includes(projectData.ownerEmail)) {
        allMembers.unshift(projectData.ownerEmail); 
    }
    if (!allMembers.includes(currentUserEmail)) {
        allMembers.push(currentUserEmail); 
    }
    const collaborators = [...new Set(allMembers)]; 

    const teacherInputs = asm.teacherInputs || {};
    const baseQuestions = asm.parsedScores || [];

    if (baseQuestions.length === 0) {
        container.innerHTML = '<p style="text-align:center; padding: 2rem; color: #94a3b8;">[표 생성]을 누르거나 AI 분석을 시작하세요.</p>';
        return;
    }

    let html = `<table class="score-table">
                <thead style="position: sticky; top: 0; background: #f1f5f9; z-index: 1;">
                <tr>
                    <th>문항</th>
                    <th style="min-width: 120px;">
                        난이도<br>
                        <div style="font-size:0.75rem; font-weight:normal; margin-top:4px; display:flex; gap:4px; justify-content:center;">
                            <select id="batch-diff-val" style="padding:2px; border-radius:4px;" onchange="lastBatchDiff = this.value">
                            <option value="상" ${typeof lastBatchDiff !== 'undefined' && lastBatchDiff === '상' ? 'selected' : ''}>상</option>
                            <option value="중" ${typeof lastBatchDiff !== 'undefined' && lastBatchDiff === '중' ? 'selected' : ''}>중</option>
                            <option value="하" ${typeof lastBatchDiff !== 'undefined' && lastBatchDiff === '하' ? 'selected' : ''}>하</option>
                        </select>
                            <button onclick="applyBatchDifficulty()" style="background:#2563eb; color:white; border:none; border-radius:4px; cursor:pointer;">일괄넣기</button>
                        </div>
                    </th> 
                    <th>배점</th>
                    
                    <th style="background: #f8fafc; min-width: 135px; text-align: center; vertical-align: middle;">
                        🤖 AI 판정<br>
                        <div style="display: flex; justify-content: center; gap: 4px; margin-top: 5px;">
                            <button onclick="toggleAiVisibility()" style="background:${typeof isAiHidden !== 'undefined' && isAiHidden ? '#10b981' : '#64748b'}; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:0.75rem; font-weight:bold; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: 0.2s;">
                                ${typeof isAiHidden !== 'undefined' && isAiHidden ? '👁️ 보이기' : '🙈 가리기'}
                            </button>
                            <button onclick="resetAiLevels()" style="background:#ef4444; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:0.75rem; font-weight:bold; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: 0.2s;">
                                🔄 초기화
                            </button>
                        </div>
                    </th>
                    
                    <th style="background:#ecfdf5; border-bottom: 2px solid #10b981;">
                        내 판정<br>
                        <button onclick="copyAiLevelsToMine()" style="margin-top:5px; background:#10b981; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:0.75rem; font-weight:bold; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">🤖 일괄 복사</button>
                    </th>`;
                    
    collaborators.forEach(email => {
        if (email !== currentUserEmail) html += `<th>${email.split('@')[0]} 선생님</th>`;
    });
    
    html += `<th style="min-width:90px; text-align:center;">
                문항 관리<br>
                <button onclick="addManualTableQuestion()" style="margin-top:4px; background:#10b981; color:white; border:none; padding:4px 8px; border-radius:4px; font-size:0.75rem; font-weight:bold; cursor:pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.2);">➕ 수동추가</button>
             </th></tr></thead><tbody>`;

    const levelToNum = { 'A+': 6, 'A': 5, 'B': 4, 'C': 3, 'D': 2, 'E': 1 };

    baseQuestions.forEach((q, qIdx) => {
        const isShort = String(q.num).includes('서') || String(q.num).startsWith('서');
        const myInput = teacherInputs[currentUserEmail]?.[qIdx]?.level || '';
        
        let minNum = myInput ? levelToNum[myInput] : null;
        let maxNum = myInput ? levelToNum[myInput] : null;

        collaborators.forEach(email => {
            const theirInput = teacherInputs[email]?.[qIdx]?.level;
            if (theirInput) {
                const num = levelToNum[theirInput];
                if (minNum === null || num < minNum) minNum = num;
                if (maxNum === null || num > maxNum) maxNum = num;
            }
        });

        let trStyle = isShort ? 'background:#fff7ed;' : '';
        let statusIcon = '';
        let cellColorStyle = ''; 

        if (minNum !== null && maxNum !== null) {
            const diffLevel = maxNum - minNum;
            if (diffLevel === 0) {
                statusIcon = ' ✅'; 
                cellColorStyle = ''; 
            } else if (diffLevel === 1) {
                statusIcon = ' ⚠️'; 
                cellColorStyle = 'background:#fff1f2; border: 2px solid #fca5a5;'; 
            } else if (diffLevel >= 2) {
                statusIcon = ' 🚨';
                cellColorStyle = 'background:#fca5a5; border: 3px solid #b91c1c; color: #7f1d1d; font-weight: 900;'; 
            }
        }

        const diff = q.difficulty || '선택하세요';

        let aiCellContentHtml = '';
        if (typeof isAiHidden !== 'undefined' && isAiHidden) {
            aiCellContentHtml = `
                <span style="background:#f1f5f9; color:#94a3b8; padding:4px 8px; border-radius:4px; font-weight:bold; font-size:0.8rem; border:1px dashed #cbd5e1; display:inline-block; box-shadow: inset 0 1px 2px rgba(0,0,0,0.05); cursor:pointer;" onclick="alert('상단의 [👁️ 보이기] 버튼을 누르시면 전체 AI 판정 내역이 공개됩니다!')" title="상단의 보이기 버튼을 누르면 공개됩니다.">🔮 블라인드</span>
                <br>
                <button disabled style="margin-top: 6px; background: #f8fafc; color: #cbd5e1; border: 1px solid #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; cursor: not-allowed;">🔒 가려짐</button>
            `;
        } else {
            const badgeColor = q.level === 'A+' ? '#ef4444' : (q.level === '판정필요' ? '#94a3b8' : '#8b5cf6');
            aiCellContentHtml = `
                <span style="background:${badgeColor}; color:white; padding:2px 6px; border-radius:4px; font-weight:bold;">${q.level || 'C'}</span>
                <br>
                <button onclick="showAiReason(${qIdx})" style="margin-top: 6px; background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; cursor: pointer; transition: 0.2s;" onmouseover="this.style.background='#e2e8f0'" onmouseout="this.style.background='#f1f5f9'">🔍 판정이유</button>
            `;
        }

        html += `<tr style="${trStyle}">
            <td style="font-size: 0.9rem; font-weight:bold; text-align:center;">${q.num}${statusIcon}</td>
            <td style="width: 120px; vertical-align: middle;">
                <div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
                    <input type="checkbox" class="diff-batch-cb" data-idx="${qIdx}" style="transform: scale(1.3); margin: 0;">
                    <select class="diff-select" onchange="updateBaseDifficulty(${qIdx}, this.value)" style="padding:4px; border-radius:4px; width: 75px; font-weight: 500;">
                        <option value=""   ${diff==='선택하세요' || diff===''?'selected':''}>선택</option>
                        <option value="상" ${diff==='상'?'selected':''}>상</option>
                        <option value="중" ${diff==='중'?'selected':''}>중</option>
                        <option value="하" ${diff==='하'?'selected':''}>하</option>
                    </select>
                </div>
            </td>
            <td><input type="number" step="0.1" class="score-input" data-num="${q.num}" value="${q.score}" onchange="updateBaseScore(${qIdx}, this.value)" style="width:50px;"></td>
            
            <td style="text-align: center; vertical-align: middle;">
                ${aiCellContentHtml}
            </td>
            
            <td style="${cellColorStyle} text-align:center; vertical-align:middle;">
                <select class="level-select" style="padding:4px; font-weight:bold;" onchange="saveMyInput(${qIdx}, this.value)">
                    <option value="" ${!myInput ? 'selected' : ''}>선택</option>
                    <option value="A+" ${myInput==='A+'?'selected':''}>A+</option>
                    <option value="A" ${myInput==='A'?'selected':''}>A</option><option value="B" ${myInput==='B'?'selected':''}>B</option>
                    <option value="C" ${myInput==='C'?'selected':''}>C</option><option value="D" ${myInput==='D'?'selected':''}>D</option><option value="E" ${myInput==='E'?'selected':''}>E</option>
                </select>
            </td>`;

        collaborators.forEach(email => {
            if (email !== currentUserEmail) {
                const theirInput = teacherInputs[email]?.[qIdx]?.level;
                html += `<td style="${cellColorStyle} text-align:center; vertical-align:middle;">${theirInput ? "<span style='color:#10b981; font-weight:bold;'>입력완료🔒</span>" : "<span style='color:#cbd5e1;'>대기중</span>"}</td>`;
            }
        });
        
        html += `<td style="text-align:center; vertical-align: middle;"><button onclick="deleteTableQuestion(${qIdx})" style="background:#fee2e2; color:#ef4444; border:1px solid #fca5a5; padding:4px 8px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:0.8rem;">🗑️ 삭제</button></td>`;
        
        html += `</tr>`;
    });
    html += `</tbody></table>`;
    container.innerHTML = html; 

    const hasAiData = baseQuestions.some(q => q.text || q.textId || q.image || q.imageId);
        // 💡 [변경됨] hasAiData가 참일 때만 뷰어 버튼을 그려줍니다!
    // 💡 [수정] 뷰어를 숨기지 않고, 클릭 불가능한 흑백(비활성화) 상태로 보여줍니다.
    let externalHtml = `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
        <div style="display: flex; gap: 8px;">
            <div style="background: #fff1f2; border: 2px solid #fca5a5; padding: 6px 14px; border-radius: 6px; font-size: 0.85rem; color: #991b1b; font-weight: bold; display: flex; align-items: center; gap: 4px;">⚠️ 1수준 다름</div>
            <div style="background: #fca5a5; border: 2px solid #b91c1c; padding: 6px 14px; border-radius: 6px; font-size: 0.85rem; color: #7f1d1d; font-weight: 900; display: flex; align-items: center; gap: 4px;">🚨 2수준 이상 다름</div>
        </div>
        <button disabled style="background: #94a3b8; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: not-allowed; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.1); filter: grayscale(100%); opacity: 0.7;">
            📄 문항 텍스트 및 그림 확인 (업데이트 예정) ⏳
        </button>
    </div>`;
    // 표에 반영한 후 문항 텍스트 및 그림 확인 정상작동 로직 나중에 업데이트 예정
    //let externalHtml = `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
    //    <div style="display: flex; gap: 8px;">
    //        <div style="background: #fff1f2; border: 2px solid #fca5a5; padding: 6px 14px; border-radius: 6px; font-size: 0.85rem; color: #991b1b; font-weight: bold; display: flex; align-items: center; gap: 4px;">⚠️ 1수준 다름</div>
    //        <div style="background: #fca5a5; border: 2px solid #b91c1c; padding: 6px 14px; border-radius: 6px; font-size: 0.85rem; color: #7f1d1d; font-weight: 900; display: flex; align-items: center; gap: 4px;">🚨 2수준 이상 다름</div>
    //    </div>
    //    ${hasAiData ? `<button onclick="openReadOnlyExamViewer()" style="background: #2563eb; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold; box-shadow: 0 4px 6px rgba(0,0,0,0.2); transition: 0.2s;">📄 문항 텍스트 및 그림 확인 👁️</button>` : ''}
    //</div>`;

    const readyStatus = asm.readyStatus || {};
    let statusHtml = `<div style="padding: 15px; background: #f8fafc; border-radius: 8px; border: 1px solid #cbd5e1; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">`;

    statusHtml += `<div><strong style="color:#334155; display:block; margin-bottom:5px;">👥 공동 작업 진행 상황:</strong>`;
    
    collaborators.forEach(email => {
        const status = readyStatus[email] || '대기 중';
        const name = email.split('@')[0]; 
        
        const isReady = status === '완료';
        const isWorking = status === '작성 중';
        const textColor = isReady ? '#166534' : (isWorking ? '#991b1b' : '#64748b');
        const bgColor = isReady ? '#dcfce7' : (isWorking ? '#fee2e2' : '#f1f5f9');
        const iconText = isReady ? '✅ 저장 완료' : (isWorking ? '✍️ 작성 중' : '⏳ 대기 중');

        statusHtml += `<span style="display:inline-block; margin-right: 8px; padding: 4px 8px; border-radius: 4px; background: ${bgColor}; color: ${textColor}; font-size: 0.85rem; font-weight: bold; border: 1px solid ${isReady ? '#86efac' : (isWorking ? '#fca5a5' : '#e2e8f0')};">
            ${name}: ${iconText}
        </span>`;
    });
    statusHtml += `</div>`;

    const myStatus = readyStatus[currentUserEmail] || '대기 중';
    const amIReady = myStatus === '완료'; 
    
    statusHtml += `<div>
        <button onclick="markAsReady()" style="background: ${amIReady ? '#10b981' : '#ea580c'}; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.95rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            ${amIReady ? '✅ 내 판정 저장 완료' : '💾 내 판정 최종 저장하기'}
        </button>
    </div></div>`;

    externalHtml += statusHtml;
    const externalContainer = document.getElementById('table-external-controls');
    if(externalContainer) externalContainer.innerHTML = externalHtml;

    if (typeof updateStep2Total === 'function') updateStep2Total();
    
    const nextBtn = document.getElementById('btn-next-to-step3');
    if (nextBtn) {
        nextBtn.style.display = 'inline-block';
        if (amIReady) {
            nextBtn.style.opacity = '1'; nextBtn.style.cursor = 'pointer'; nextBtn.onclick = typeof handleNextToPath1Result !== 'undefined' ? handleNextToPath1Result : null;
            nextBtn.innerHTML = "내 판정으로 분할점수 산출 ➡️"; nextBtn.style.background = "#ea580c";
        } else {
            nextBtn.style.opacity = '0.5'; nextBtn.style.cursor = 'not-allowed';
            nextBtn.innerHTML = "🔒 '내 판정 저장 완료' 시 산출 가능"; nextBtn.style.background = "#64748b";
        }
    }
    if (typeof parsedScores !== 'undefined') parsedScores = baseQuestions;
    if (typeof initDiffShiftClick === 'function') setTimeout(initDiffShiftClick, 100); 
}

// ✨ (추가할 초기화 함수 - 위 함수 바로 아래에 넣어주세요)
async function resetAiLevels() {
    if(!confirm("모든 AI 판정 결과를 '판정필요' 상태로 초기화하시겠습니까?\n(배점과 난이도, 선생님이 판정한 '내 판정' 기록은 그대로 유지됩니다.)")) return;

    try {
        const docRef = db.collection('user_projects').doc(currentProjectId);
        const doc = await docRef.get();
        if(doc.exists) {
            let assessments = doc.data().assessments;
            let baseScores = assessments[currentEditingAssessmentIndex].parsedScores || [];
            
            baseScores.forEach(q => {
                q.level = '판정필요';
                q.reason = '선생님의 요청으로 AI 판정 결과가 초기화되었습니다.';
            });

            await docRef.update({ assessments: assessments });
            // onSnapshot을 통해 화면이 알아서 리렌더링 됩니다.
        }
    } catch(e) {
        alert("초기화 실패: " + e.message);
    }
}


// 🟢 [완벽 수정] 표 안에서 문항을 지워도 번호가 당겨지지 않고 원래 번호 유지!
async function deleteTableQuestion(qIdx) {
    if(!confirm("이 문항을 전체 협업 표에서 영구 삭제하시겠습니까?\n삭제 시 남은 문항 번호는 원래 번호를 유지하며 합계 점수가 동기화됩니다.")) return;
    
    try {
        const docRef = db.collection('user_projects').doc(currentProjectId);
        const doc = await docRef.get();
        if(!doc.exists) return;

        let assessments = doc.data().assessments;
        let asm = assessments[currentEditingAssessmentIndex];
        let baseScores = asm.parsedScores || [];
        
        // 1. 선택한 문항 삭제
        baseScores.splice(qIdx, 1);
        
        // 💡 [찌꺼기 제거 완료] 강제로 1번부터 매기던 objIdx, subIdx 로직을 완전 삭제했습니다!
        
        asm.parsedScores = baseScores;
        
        // 2. 다른 선생님들이 체크해 둔 '내 판정' 점수에서도 해당 줄 삭제 동기화
        if (asm.teacherInputs) {
            Object.keys(asm.teacherInputs).forEach(email => {
                if (asm.teacherInputs[email] && asm.teacherInputs[email].length > qIdx) {
                    asm.teacherInputs[email].splice(qIdx, 1);
                }
            });
        }

        await docRef.update({ assessments: assessments });
        
    } catch(e) {
        alert("문항 삭제 실패: " + e.message);
    }
}

async function saveMyInput(qIdx, levelValue) {
    if (!currentProjectId || currentEditingAssessmentIndex === -1) return;
    try {
        const docRef = db.collection('user_projects').doc(currentProjectId);

        // 🔒 마법의 자물쇠(트랜잭션) 시작
        await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(docRef);
            if(!doc.exists) return;

            let assessments = doc.data().assessments;
            let asm = assessments[currentEditingAssessmentIndex];

            if (!asm.teacherInputs) asm.teacherInputs = {};
            if (!asm.teacherInputs[auth.currentUser.email]) asm.teacherInputs[auth.currentUser.email] = [];

            while(asm.teacherInputs[auth.currentUser.email].length <= qIdx) { 
                asm.teacherInputs[auth.currentUser.email].push({}); 
            }
            asm.teacherInputs[auth.currentUser.email][qIdx] = { level: levelValue };

            // 💡 [버그 수정] false 대신 '작성 중'이라는 글자가 정확히 들어가도록 수정했습니다.
            if(asm.readyStatus && asm.readyStatus[auth.currentUser.email]) {
                asm.readyStatus[auth.currentUser.email] = '작성 중'; 
            }

            transaction.update(docRef, { assessments: assessments });
        });
    } catch(e) { console.error("입력 저장 실패", e); }
}

// ✨ 배점을 수정하면 모두의 화면에서 배점이 함께 바뀌는 함수
async function updateBaseScore(qIdx, scoreValue) {
    if (!currentProjectId || currentEditingAssessmentIndex === -1) return;
    try {
        const docRef = db.collection('user_projects').doc(currentProjectId);
        const doc = await docRef.get();
        if(doc.exists) {
            let assessments = doc.data().assessments;
            assessments[currentEditingAssessmentIndex].parsedScores[qIdx].score = parseFloat(scoreValue) || 0;
            await docRef.update({ assessments: assessments });
        }
    } catch(e) { console.error("배점 갱신 실패", e); }
}
// ✨ AI의 판정 결과를 내 입력칸에 한 번에 복사하는 기능
async function copyAiLevelsToMine() {
    if (!currentProjectId || currentEditingAssessmentIndex === -1) return;
    if (!confirm("💡 AI가 1차로 판정한 성취수준을 내 칸에 모두 복사하시겠습니까?\n(복사 후 문항별로 수정하실 수 있습니다.)")) return;

    try {
        const docRef = db.collection('user_projects').doc(currentProjectId);
        const doc = await docRef.get();
        if(doc.exists) {
            let assessments = doc.data().assessments;
            let asm = assessments[currentEditingAssessmentIndex];
            let baseQuestions = asm.parsedScores || [];
            const userEmail = auth.currentUser.email;

            if (!asm.teacherInputs) asm.teacherInputs = {};
            if (!asm.teacherInputs[userEmail]) asm.teacherInputs[userEmail] = [];

            // AI의 레벨(q.level)을 내 칸으로 전부 복사
            baseQuestions.forEach((q, idx) => {
                while(asm.teacherInputs[userEmail].length <= idx) asm.teacherInputs[userEmail].push({});
                asm.teacherInputs[userEmail][idx].level = q.level || 'C'; 
            });

            // 💡 일괄 복사를 눌렀다면 수정사항이 생겼으므로 '작성 중'으로 되돌립니다.
            if(asm.readyStatus && asm.readyStatus[userEmail]) {
                asm.readyStatus[userEmail] = false;
            }

            await docRef.update({ assessments: assessments });
            // onSnapshot이 작동 중이라 화면은 스스로 짠! 하고 바뀝니다.
        }
    } catch(e) { alert("복사 중 오류 발생: " + e.message); }
}
// ✨ 난이도를 수정하면 모두의 화면에서 난이도가 함께 바뀌는 함수 (M자 분석 연동)
async function updateBaseDifficulty(qIdx, diffValue) {
    if (!currentProjectId || currentEditingAssessmentIndex === -1) return;
    try {
        const docRef = db.collection('user_projects').doc(currentProjectId);
        const doc = await docRef.get();
        if(doc.exists) {
            let assessments = doc.data().assessments;
            // 해당 문항의 난이도를 업데이트
            assessments[currentEditingAssessmentIndex].parsedScores[qIdx].difficulty = diffValue;
            await docRef.update({ assessments: assessments });
        }
    } catch(e) { console.error("난이도 갱신 실패", e); }
}

// 👇 아래 코드로 통째로 교체해주세요!
function toggleExamViewer() {
    const wrapper = document.getElementById('exam-inspector-wrapper');
    const toggleBtn = document.getElementById('exam-viewer-toggle-btn');
    
    if (!wrapper) return;

    // 💡 [수정됨] 처음 로딩되어 display 값이 비어있는('') 경우도 '닫혀있음'으로 간주!
    if (wrapper.style.display === 'none' || wrapper.style.display === '') {
        wrapper.style.display = 'flex';
        if(toggleBtn) toggleBtn.innerText = "📄 시험지 닫기 🔼";
        toggleBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
        wrapper.style.display = 'none';
        if(toggleBtn) toggleBtn.innerText = "📄 시험지 파일 및 편집 확인 🔽";
    }
}

// 💡 [수정됨] 보조 서랍(project_images, project_texts) 연동 문항 텍스트 & 그림 뷰어
window.openReadOnlyExamViewer = async function() {
    const asm = cachedProjectData?.assessments?.[currentEditingAssessmentIndex];
    if (!asm || !asm.parsedScores || asm.parsedScores.length === 0) {
        alert("현재 저장된 문항 데이터가 없습니다.\n(먼저 AI 분석 후 표에 반영해 주세요.)");
        return;
    }

    // 🚨 여기서 user_projects의 baseScores에는 전체 텍스트나 Base64 이미지가 없어야 정상입니다. 
    // 오직 문항번호, 배점, imageId 만 존재해야 합니다.
    const baseScores = asm.parsedScores;

    let viewerModal = document.getElementById('readonly-exam-modal');
    if (!viewerModal) {
        // ... (기존 모달 UI 생성 로직 유지) ...
        viewerModal = document.createElement('div');
        viewerModal.id = 'readonly-exam-modal';
        viewerModal.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999; display:flex; justify-content:center; align-items:center;";
        viewerModal.innerHTML = `
            <div style="background:white; width:95%; max-width:800px; height:85vh; border-radius:12px; display:flex; flex-direction:column; box-shadow:0 10px 25px rgba(0,0,0,0.2);">
                <div style="padding:15px 20px; background:#1e3a8a; color:white; border-radius:12px 12px 0 0; display:flex; justify-content:space-between; align-items:center;">
                    <h3 style="margin:0; font-size:1.2rem;">📄 문항 확인 (읽기 전용)</h3>
                    <button onclick="document.getElementById('readonly-exam-modal').style.display='none'" style="background:none; border:none; color:white; font-size:1.8rem; cursor:pointer; line-height:1;">&times;</button>
                </div>
                <div id="readonly-exam-content" style="padding:20px; overflow-y:auto; flex:1; background:#f8fafc;"></div>
            </div>
        `;
        document.body.appendChild(viewerModal);
    }

    viewerModal.style.display = 'flex';
    const contentDiv = document.getElementById('readonly-exam-content');
    contentDiv.innerHTML = '<div style="text-align:center; padding:3rem; color:#64748b; font-weight:bold;">⏳ 통합 DB에서 데이터를 불러오는 중입니다...</div>';

    // 🌟 1단계: 텍스트 통합 문서(project_texts)를 딱 1번만 불러옵니다.
    let masterTexts = {};
    try {
        const textDoc = await db.collection('project_texts').doc(currentProjectId).get();
        if (textDoc.exists && textDoc.data().texts) {
            masterTexts = textDoc.data().texts;
        }
    } catch (e) { console.error("통합 텍스트 로딩 실패:", e); }

    let html = '';
    for (const q of baseScores) {
        html += `
            <div style="background:white; border:1px solid #cbd5e1; border-radius:8px; padding:15px; margin-bottom:15px; box-shadow:0 2px 4px rgba(0,0,0,0.05);">
                <div style="font-weight:bold; color:#1e3a8a; border-bottom:2px solid #bfdbfe; padding-bottom:5px; margin-bottom:10px; font-size:1.1rem; display: flex; justify-content: space-between; align-items: center;">
                    <span>[문항 ${q.num}]</span>
                    <span style="color: #ea580c; font-size: 0.95rem;">배점: ${q.score || 0}점</span>
                </div>
        `;
        
        // 🌟 2단계: user_projects에는 텍스트가 없으므로, 불러온 통합 문서(masterTexts)에서 텍스트를 꺼냅니다.
        const textKey = `asm${currentEditingAssessmentIndex}_q${q.num}`;
        const fullTextToDisplay = masterTexts[textKey] || q.text; // (q.text는 만약을 위한 폴백)

        if (fullTextToDisplay) {
            let safeText = fullTextToDisplay.replace(/\n/g, '<br>');
            html += `<div style="font-size:0.95rem; color:#334155; line-height:1.6; margin-bottom:10px;">${safeText}</div>`;
        } else {
            html += `<div style="font-size:0.9rem; color:#94a3b8; margin-bottom:10px; font-style:italic;">(저장된 문항 텍스트 없음)</div>`;
        }
        
        // 🌟 3단계: user_projects에는 원본 이미지 대신 imageId(열쇠)만 있어야 합니다.
        if (q.imageId) {
            html += `<div id="img-container-${q.imageId}" style="text-align:center; padding:15px; background:#f1f5f9; border-radius:6px; font-size:0.85rem; color:#64748b; border: 1px dashed #cbd5e1;">⏳ 보조 DB에서 그림을 꺼내고 있습니다...</div>`;
        } else if (q.image) {
            // 이 분기를 타는 데이터가 있다면 user_projects 정리가 아직 덜 된 과거 데이터입니다.
            html += `<div style="text-align:center; margin-top:10px;"><img src="${q.image}" style="max-width:100%; border-radius:4px; border:1px solid #e2e8f0;"></div>`;
        }
        html += `</div>`;
    } 

    contentDiv.innerHTML = html;

    if (window.MathJax) MathJax.typesetPromise([contentDiv]).catch(err => console.error(err));

    // 4단계: 이미지 열쇠(imageId)를 가진 문항들만 별도의 project_images DB에서 그림을 꺼내옵니다.
    const imageFetchPromises = baseScores.filter(q => q.imageId).map(async (q) => {
        try {
            const imgDoc = await db.collection('project_images').doc(q.imageId).get();
            const container = document.getElementById(`img-container-${q.imageId}`);
            if (imgDoc.exists && container) {
                const data = imgDoc.data();
                container.innerHTML = `<img src="${data.base64Data}" style="max-width:100%; border-radius:4px; border:1px solid #cbd5e1;">`;
            } else if (container) {
                container.innerHTML = "❌ 이미지를 찾을 수 없습니다.";
            }
        } catch (e) {
            const container = document.getElementById(`img-container-${q.imageId}`);
            if (container) container.innerHTML = "❌ 이미지 로드 중 오류 발생";
        }
    });

    await Promise.all(imageFetchPromises);
};

async function markAsReady() {
    if (!currentProjectId || currentEditingAssessmentIndex === -1) return;
    try {
        const docRef = db.collection('user_projects').doc(currentProjectId);
        
        // 1. 빈칸이 있는지 먼저 슬쩍 확인합니다.
        const docForCheck = await docRef.get();
        if(!docForCheck.exists) return;
        
        const asmCheck = docForCheck.data().assessments[currentEditingAssessmentIndex];
        const baseLen = asmCheck.parsedScores ? asmCheck.parsedScores.length : 0;
        const myInputs = asmCheck.teacherInputs?.[auth.currentUser.email] || [];
        const filledCount = myInputs.filter(i => i && i.level).length;

        let statusToSave = '완료';
        if(filledCount < baseLen) {
            if(!confirm("⚠️ 아직 성취수준을 판정하지 않은 빈칸이 있습니다.\n현재까지의 내용을 '임시 저장(작성 중)' 상태로 두시겠습니까?")) return;
            statusToSave = '작성 중'; 
        }

        // 🔒 마법의 자물쇠(트랜잭션) 시작
        await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(docRef);
            if (!doc.exists) return;

            let assessments = doc.data().assessments;
            let asm = assessments[currentEditingAssessmentIndex];

            if (!asm.readyStatus) asm.readyStatus = {};
            asm.readyStatus[auth.currentUser.email] = statusToSave; 
            
            transaction.update(docRef, { assessments: assessments });
        });
        
        // 알림은 자물쇠가 무사히 풀린 뒤에 띄웁니다.
        alert("✅ 내 판정 상황이 안전하게 저장되었습니다.");

    } catch(e) { alert("저장 실패: " + e.message); }
}

async function applyBatchDifficulty() {
    const val = document.getElementById('batch-diff-val').value;
    lastBatchDiff = val; // ✨ 마지막으로 선택한 난이도를 시스템에 강제 저장!
    
    const cbs = document.querySelectorAll('.diff-batch-cb:checked');
    if(cbs.length === 0) { alert("선택된 문항이 없습니다. 왼쪽 체크박스를 선택해주세요."); return; }

    try {
        const docRef = db.collection('user_projects').doc(currentProjectId);
        const doc = await docRef.get();
        if(doc.exists) {
            let assessments = doc.data().assessments;
            cbs.forEach(cb => {
                const idx = parseInt(cb.getAttribute('data-idx'));
                assessments[currentEditingAssessmentIndex].parsedScores[idx].difficulty = val;
            });
            await docRef.update({ assessments: assessments });
        }
    } catch(e) { 
        alert("일괄 적용 실패: " + e.message); 
    }
}

// 🌟 통합 상태창 렌더링 함수
// 🌟 통합 상태창 렌더링 함수 (모두 완료 시에만 비교하기 활성화)
function updateMTableStatus(asm, projectData) {
    const infoZone = document.getElementById('current-assessment-info');
    const compareBtn = document.getElementById('btn-compare-m');
    const myEmail = auth.currentUser.email;

    if (!infoZone || !asm) return;

    const examTitle = `${asm.name || '평가명 없음'} (${asm.weight || 0}%)`;
    let allMembers = projectData.collaborators || [];
    if (projectData.ownerEmail && !allMembers.includes(projectData.ownerEmail)) allMembers.unshift(projectData.ownerEmail);
    if (!allMembers.includes(myEmail)) allMembers.push(myEmail);
    const collaborators = [...new Set(allMembers)];

    let missingTeachers = [];
    let statusHTML = `<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;">`;

    collaborators.forEach(email => {
        const name = email.split('@')[0];
        if (asm.teacherCutScores && asm.teacherCutScores[email]) {
            statusHTML += `<span style="background: #dcfce7; color: #166534; padding: 4px 8px; border-radius: 4px; border: 1px solid #86efac; font-size: 0.8rem; font-weight: bold;">✅ ${name}: 완료</span>`;
        } else {
            missingTeachers.push(name);
            statusHTML += `<span style="background: #f1f5f9; color: #64748b; padding: 4px 8px; border-radius: 4px; border: 1px solid #e2e8f0; font-size: 0.8rem; font-weight: bold;">⏳ ${name}: 대기</span>`;
        }
    });
    statusHTML += `</div>`;

    const isFinal = (missingTeachers.length === 0);
    const amIComplete = (asm.teacherCutScores && asm.teacherCutScores[myEmail]);

    let titleHtml = `<div style="color:#1e3a8a; font-size:1.1rem; font-weight:900; margin-bottom:5px;">📌 ${examTitle}</div>`;

    // 💡 선생님의 기획대로 상태에 따라 버튼을 엄격하게 제어합니다.
    if (isFinal) {
        infoZone.innerHTML = titleHtml + `<div style="color:#166534; font-size:0.9rem; font-weight:bold;">🎉 모든 교사 산출 완료!</div>` + statusHTML;
        infoZone.style.background = "#f0fdf4"; infoZone.style.border = "2px solid #22c55e";
        if (compareBtn) { compareBtn.disabled = false; compareBtn.style.background = "#8b5cf6"; compareBtn.style.cursor = "pointer"; compareBtn.innerHTML = "📊 비교하기 (활성)"; }
    } else if (amIComplete) {
        infoZone.innerHTML = titleHtml + `<div style="color:#92400e; font-size:0.9rem; font-weight:bold;">💾 내 점수 저장 완료! (다른 교사 대기중)</div>` + statusHTML;
        infoZone.style.background = "#fffbeb"; infoZone.style.border = "2px solid #f59e0b";
        if (compareBtn) { compareBtn.disabled = true; compareBtn.style.background = "#94a3b8"; compareBtn.style.cursor = "not-allowed"; compareBtn.innerHTML = "📊 비교하기 (대기)"; }
    } else {
        infoZone.innerHTML = titleHtml + `<div style="color:#334155; font-size:0.9rem; font-weight:bold;">👥 교사별 산출 저장 현황</div>` + statusHTML;
        infoZone.style.background = "#f8fafc"; infoZone.style.border = "1px solid #cbd5e1";
        if (compareBtn) { compareBtn.disabled = true; compareBtn.style.background = "#94a3b8"; compareBtn.style.cursor = "not-allowed"; compareBtn.innerHTML = "📊 비교하기 (대기)"; }
    }
}

function initDiffShiftClick() {
    const checkboxes = document.querySelectorAll('.diff-batch-cb');
    let lastChecked = null;
    checkboxes.forEach(cb => {
        cb.addEventListener('click', function(e) {
            if (!lastChecked) { lastChecked = this; return; }
            if (e.shiftKey) {
                const start = Array.from(checkboxes).indexOf(this);
                const end = Array.from(checkboxes).indexOf(lastChecked);
                checkboxes.forEach((checkbox, i) => {
                    if (i >= Math.min(start, end) && i <= Math.max(start, end)) {
                        checkbox.checked = lastChecked.checked;
                    }
                });
            }
            lastChecked = this;
        });
    });
}

// ==========================================
// 📸 [추가] 이미지 조각을 DB 저장용으로 아주 작게 압축하는 함수
// ==========================================
function compressCaptureImage(base64Str, callback) {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 600; // 가로를 600px로 제한 (용량 다이어트)
        let width = img.width;
        let height = img.height;

        if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // 화질을 50%로 낮춰서 텍스트 길이를 대폭 줄임
        const compressed = canvas.toDataURL('image/jpeg', 0.5);
        callback(compressed);
    };
}

async function transformAndSaveExamToBank(skipConfirm = false) {
    if(extractedQuestionsArray.length === 0) return;
    if(!skipConfirm) {
        if(!confirm("추출된 문항들을 AI 변형 문항으로 재구성하여 '문제 서랍(DB)'에 저장하시겠습니까?\n(첨부된 그림 조각들도 함께 저장되어 성취평가제 신뢰도 제고에 활용됩니다.)")) return;
    }

    if (!requireApiKey()) return;

    const btn = document.querySelector('button[onclick="saveBankAndApplyTable()"]') || document.querySelector('button[onclick="transformAndSaveExamToBank()"]');
    const originalBtnText = btn ? btn.innerText : "💾 문제은행에 저장하고 표에 반영";
    if(btn) {
        btn.innerText = "⏳ AI가 일괄 저작권 변형 및 백엔드 연동 처리 중...";
        btn.disabled = true;
    }

    try {
        let standardsInfo = "";
        for (const key in subjectData) {
            if (subjectData[key].standards && subjectData[key].standards.length > 0) {
                standardsInfo += `\n--- ${subjectData[key].title} ---\n`;
                standardsInfo += subjectData[key].standards.map(s => `${s.code} ${s.desc}`).join('\n');
            }
        }

        let targetSubject = document.getElementById('cut-score-subject')?.value || currentSubject || "uncategorized";
        let questionsPayload = extractedQuestionsArray.map(q => q.text);
        const workerUrl = "https://script.google.com/macros/s/AKfycbwgx4RgF8FQxxL3jBgEQ5l369llADjhZ1NepulIdF4DdX18kBrB8oRQ4Ft0d5WdKtEF/exec";
        const userApiKey = localStorage.getItem('gemini_api_key');
        
        const response = await fetch(workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: "batch_transform",
                standardsInfo: standardsInfo,
                subject: targetSubject, 
                questionsPayload: questionsPayload,
                apiKey: userApiKey
            })
        });

        await checkApiError(response);
        const data = await response.json();
        const aiResult = data.candidates[0].content.parts[0].text;

        const blocks = aiResult.split('===').map(b => b.trim()).filter(b => b.length > 0);
        let savedCount = 0;

        // ... (앞부분 동일) ...
        for (let i = 0; i < Math.min(blocks.length, extractedQuestionsArray.length); i++) {
            const block = blocks[i];
            const originalData = extractedQuestionsArray[i]; 

            const qMatch = block.match(/변형문제:\s*([\s\S]*?)(?=변형그림:|변형정답:|판정이유:|$)/);
            const imgMatch = block.match(/변형그림:\s*([\s\S]*?)(?=변형정답:|판정이유:|$)/);
            const aMatch = block.match(/변형정답:\s*([\s\S]*?)(?=판정이유:|$)/);
            const cMatch = block.match(/성취기준코드:\s*([^\n]+)/);
            const rMatch = block.match(/판정이유:\s*([\s\S]*)/);

            let finalQ = qMatch ? qMatch[1].trim() : originalData.text;
            let finalA = aMatch ? aMatch[1].trim() : "정답 정보 없음";
            let svgCode = imgMatch ? imgMatch[1].trim() : "";
            
            if (svgCode && svgCode !== "없음") {
                finalQ += `\n\n${svgCode}`; 
            }

            // 💡 융합 문항일 경우 쉼표(,)로 구분된 코드를 분리하여 배열로 만듭니다.
            let finalCodes = cMatch ? cMatch[1].replace(/[\[\]\s]/g, '').split(',').filter(c => c.length > 0) : ["코드없음"]; 
            let finalReason = rMatch ? rMatch[1].trim() : "AI가 교육과정 루브릭을 바탕으로 분석한 문항입니다.";

            let levelMatch = originalData.text.match(/\[수준\]\s*(A\+|[A-E])/);
            let lvl = levelMatch ? levelMatch[1] : "C";
            if(lvl === "A+") lvl = "A";

            let compressedImage = null;
            if (originalData.image) {
                await new Promise(resolve => {
                    compressCaptureImage(originalData.image, (compressed) => {
                        compressedImage = compressed; 
                        resolve();
                    });
                });
            }

            // 🚨 [핵심 수정] for문을 완전히 삭제하고 딱 한 번만 저장하도록 수정했습니다!
            let autoSubject = typeof detectSubjectIdFromStandardCode === 'function' ? detectSubjectIdFromStandardCode(finalCodes[0]) : targetSubject;
            
            const saveData = {
                subject: autoSubject || targetSubject, 
                standard_code: finalCodes, // 💡 여러 코드가 담긴 배열 자체를 단 한 번만 저장!
                question: finalQ,
                answer: finalA,          
                level: lvl, 
                reason: finalReason,     
                source: "📄 시험지 일괄 변형 저장",
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                user_email: auth.currentUser ? auth.currentUser.email : "알 수 없음"
            };
            if (compressedImage) saveData.image = compressedImage;

            await db.collection('transformed_bank').add(saveData);
            savedCount++; // 문항 1개당 1번만 카운트됨
        }

        alert(`🎉 완벽합니다! 총 ${savedCount}개의 시험지 문항이 변형되어 알맞은 과목 DB에 보관되었습니다.`);

        // 저장 후 화면 버튼을 다시 파란색으로 깨워주는 함수 실행
        await updateQuestionCount(); 

    } catch (error) {
        alert("변형 저장 중 오류 발생: " + error.message);
    } finally {
        if(btn) {
            btn.innerText = originalBtnText;
            btn.disabled = false;
        }
    }
}

// ✅ [신규 추가] 저장 버튼을 눌렀을 때만 변형 문항 생성을 시작하고 화면을 초기화합니다.
async function triggerSaveBackgroundAndReset() {
    const apiKey = localStorage.getItem('gemini_api_key');
    
    // 현재 분석된 텍스트가 없으면 중단
    if (!apiKey || !currentChatContext) {
        alert("분석된 데이터가 없습니다.");
        return;
    }

    const btn = document.getElementById('save-variant-btn');
    const originalText = btn ? btn.innerText : "";

    try {
        if (btn) {
            btn.disabled = true;
            btn.innerText = "⏳ AI가 문항을 변형하여 저장 중입니다...";
        }

        // 선생님이 동의하셨으므로, 이제 비로소 백그라운드에서 저장을 시작합니다.
        // 유저를 기다리게 하지 않기 위해 .then() 방식을 사용하여 비동기로 처리합니다.
        processAndSaveBackground(currentChatContext, apiKey).then(() => {
            console.log("✅ 변형 문항 데이터베이스 저장 완료");
        }).catch(err => {
            console.error("❌ 저장 중 오류 발생:", err);
        });

        // 사용자에게는 즉시 알림을 주고 화면을 다음 분석을 위해 비워줍니다.
        alert("✅ 문항 분석 결과가 문제은행에 기여되었습니다!\n(AI가 저작권 보호를 위해 문항을 변형하여 안전하게 보관합니다.)");
        
        // 분석 결과 화면 리셋 (main.js에 이미 정의된 함수 호출)
        resetAnalysis(true);

    } catch (e) {
        alert("저장 처리 중 오류가 발생했습니다: " + e.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = originalText;
        }
    }
}
// ==========================================
// 🌌 관리자 전용: 궁극의 만능 서랍 제어 로직 (동적 필터 적용)
// ==========================================

function escapeCSV(str) {
    if (str === undefined || str === null) return '""';
    let cleanStr = str.toString();
    return `"${cleanStr.replace(/"/g, '""')}"`;
}

// ✨ [수정됨] 서랍을 선택하면 그에 맞는 하위 분류(전 과목) 드롭다운을 자동으로 세팅하는 함수
function updateUniversalFilter() {
    const drawerSelect = document.getElementById('universal-drawer-select').value;
    const drawerInput = document.getElementById('universal-drawer-input');
    const filterSelect = document.getElementById('universal-filter-select');
    
    // '직접 입력' 모드 처리
    if (drawerSelect === 'custom') {
        drawerInput.value = '';
        drawerInput.readOnly = false;
        drawerInput.focus();
        filterSelect.innerHTML = '<option value="all">전체 다운로드 (필터 없음)</option>';
        filterSelect.style.background = '#f1f5f9';
    } else {
        drawerInput.value = drawerSelect;
        drawerInput.readOnly = true;
        
        // 문제 은행이나 성취기준 서랍이면 전 과목 필터 동적 생성!
        if (drawerSelect === 'transformed_bank' || drawerSelect === 'standards_2022') {
            let html = '<option value="all">🌐 전체 과목 한 번에 다운로드</option>';
            
            // 선생님이 만들어두신 curriculumMap을 순회하며 전 과목을 예쁘게 묶어줍니다.
            const groupNames = { 'math': '수학', 'korean': '국어', 'english': '영어', 'social': '사회', 'science': '과학' };
            
            for (const groupId in curriculumMap) {
                html += `<optgroup label="=== 📚 ${groupNames[groupId] || groupId} 교과군 ===">`;
                for (const category in curriculumMap[groupId]) {
                    curriculumMap[groupId][category].forEach(sub => {
                        if (sub.id !== 'uncategorized') {
                            html += `<option value="${sub.id}">- ${sub.name}</option>`;
                        }
                    });
                }
                html += `</optgroup>`;
            }
            html += `<option value="uncategorized">📦 미분류 보관함</option>`;
            
            filterSelect.innerHTML = html;
            filterSelect.style.background = '#fffbeb';
        } else {
            // 다른 서랍(의견, 폴더 등)은 기본적으로 전체 다운로드만 제공
            filterSelect.innerHTML = '<option value="all">🌐 전체 다운로드 (세부 필터 미지원 서랍)</option>';
            filterSelect.style.background = '#f1f5f9';
        }
    }
}

// 1. 분류가 적용된 데이터를 스마트하게 분석하여 엑셀로 다운로드
async function downloadUniversalData() {
    const collectionName = document.getElementById('universal-drawer-input').value.trim();
    const filterVal = document.getElementById('universal-filter-select').value;
    
    if (!collectionName) {
        alert("서랍 이름을 확인해 주세요.");
        return;
    }

    const btn = document.querySelector('button[onclick="downloadUniversalData()"]');
    const originalText = btn.innerText;
    btn.innerText = "⏳ 데이터 구조 분석 및 필터링 중...";

    try {
        // ✨ 필터값에 따라 DB 쿼리(요청)를 다르게 날립니다.
        let query = db.collection(collectionName);
        if (filterVal !== 'all' && (collectionName === 'transformed_bank' || collectionName === 'standards_2022')) {
            query = query.where('subject', '==', filterVal);
        }

        const snapshot = await query.get();
        if (snapshot.empty) {
            alert(`해당 조건('${filterVal}')에 일치하는 데이터가 없습니다.`);
            return;
        }

        // 모든 필드명 긁어모으기
        let allKeysSet = new Set();
        snapshot.forEach(doc => { Object.keys(doc.data()).forEach(key => allKeysSet.add(key)); });
        const headers = Array.from(allKeysSet); 

        // 엑셀 만들기
        let csvContent = "\uFEFF고유 ID(수정금지)," + headers.join(",") + "\n";
        snapshot.forEach(doc => {
            const data = doc.data();
            let rowValues = [escapeCSV(doc.id)]; 

            headers.forEach(header => {
                let val = data[header];
                if (typeof val === 'object' && val !== null) {
                    if (val.toDate) val = val.toDate().toLocaleString(); 
                    else val = JSON.stringify(val); 
                }
                rowValues.push(escapeCSV(val));
            });
            csvContent += rowValues.join(",") + "\n";
        });

        const filterName = filterVal === 'all' ? '전체' : filterVal;
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `만능백업_${collectionName}_${filterName}_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();

    } catch (error) { alert("다운로드 실패: " + error.message); } 
    finally { btn.innerText = originalText; }
}

// 2. 만능 스마트 업로드 (그대로 유지)
async function uploadUniversalData(event) {
    const file = event.target.files[0];
    if(!file) return;

    const collectionName = document.getElementById('universal-drawer-input').value.trim();
    if (!collectionName) {
        alert("저장할 대상 서랍 이름이 비어있습니다.");
        event.target.value = ""; return;
    }

    if(!confirm(`[${collectionName}] 서랍에 엑셀 데이터를 밀어 넣습니다.\n엑셀의 첫 번째 줄(열 이름)이 데이터베이스의 필드명으로 적용됩니다.`)) {
        event.target.value = ""; return;
    }

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, {header: 1});
            
            if (jsonData.length < 2) { alert("데이터가 없습니다."); return; }

            const headers = jsonData[0]; 
            if (headers[0] !== "고유 ID(수정금지)") {
                alert("경고: A열의 이름이 '고유 ID(수정금지)'가 아닙니다. 다운받은 양식을 사용해 주세요.");
                return;
            }

            let updateCount = 0; let insertCount = 0;

            for (let i = 1; i < jsonData.length; i++) {
                const row = jsonData[i];
                if (!row || row.length === 0) continue;

                const docId = row[0] ? row[0].toString().trim() : "";
                let rowData = {};
                let hasData = false;

                for (let j = 1; j < headers.length; j++) {
                    const fieldName = headers[j];
                    if (!fieldName) continue;

                    let val = row[j];
                    if (val === undefined || val === "") continue; 

                    if (typeof val === 'string' && (val.trim().startsWith('{') || val.trim().startsWith('['))) {
                        try { val = JSON.parse(val.trim()); } catch (e) { }
                    }
                    rowData[fieldName] = val;
                    hasData = true;
                }

                if (!hasData) continue; 

                // 💡 [안전장치] 문항 보관함(transformed_bank)일 경우 딱 7개 필드 포맷만 엄격히 강제함
                if (collectionName === 'transformed_bank') {
                    const permitted = ['answer', 'level', 'question', 'reason', 'standard_code', 'subject', 'timestamp'];
                    let sanitizedData = {};
                    
                    permitted.forEach(field => {
                        if (rowData[field] !== undefined) {
                            sanitizedData[field] = rowData[field];
                        }
                    });

                    // 💡 레벨이 소문자(a, b, c)로 들어오면 대문자로 자동 보정
                    if (sanitizedData.level) {
                        sanitizedData.level = sanitizedData.level.toString().toUpperCase().trim();
                    }

                    // 💡 엑셀 수정을 거치면서 꼬인 날짜 정보는 Firebase 서버 시간으로 안전하게 동기화
                    sanitizedData.timestamp = firebase.firestore.FieldValue.serverTimestamp();
                    
                    rowData = sanitizedData;
                }

                // 🚀 정제된 데이터로 안전하게 DB 반영 (고유 ID가 있으면 덮어쓰기, 없으면 신규 추가)
                if (docId) {
                    await db.collection(collectionName).doc(docId).set(rowData, { merge: true });
                    updateCount++;
                } else {
                    await db.collection(collectionName).add(rowData);
                    insertCount++;
                }
            }

            alert(`🚀 [${collectionName}] 만능 업로드 완료!\n\n- 내용 덮어쓰기: ${updateCount}건\n- 신규 문서 추가: ${insertCount}건`);
            document.getElementById('universal-bulk-upload-input').value = "";
        } catch(error) {
            alert("만능 업로드 에러: " + error.message);
            document.getElementById('universal-bulk-upload-input').value = "";
        }
    };
    reader.readAsArrayBuffer(file);
}

// 💡 스크립트 맨 아랫부분 window.onload 안에 아래 함수 호출을 꼭 추가해주세요!
// 기존 onload 내부 끝부분에 추가:
// updateUniversalFilter();

// 평가 이름과 비율만 수정하는 안전한 함수
async function editAssessmentInfo(index) {
    const docRef = db.collection('user_projects').doc(currentProjectId);
    const doc = await docRef.get();
    let assessments = doc.data().assessments;
    let asm = assessments[index];

    const newName = prompt("새로운 평가명을 입력하세요:", asm.name);
    if(newName === null || newName.trim() === "") return;

    const newWeight = prompt("새로운 반영 비율(%)을 숫자로만 입력하세요:", asm.weight);
    if(newWeight === null || newWeight.trim() === "" || isNaN(newWeight)) return;

    const oldWeight = asm.weight || 0;
    asm.name = newName.trim();
    asm.weight = parseFloat(newWeight);

    // 💡 변경된 비율에 맞춰 A~E 최종 점수 자동 비례 계산
    if (oldWeight !== asm.weight && oldWeight > 0 && asm.scores) {
        const ratio = asm.weight / oldWeight;
        asm.scores.A *= ratio;
        asm.scores.B *= ratio;
        asm.scores.C *= ratio;
        asm.scores.D *= ratio;
        asm.scores.E *= ratio;
    }

    try {
        await docRef.update({ assessments: assessments });
        alert("✅ 평가명과 반영 비율이 수정되었으며, 최종 컷오프 점수도 새 비율에 맞춰 자동 재계산되었습니다!");
        loadProjectDetails(); // 화면 새로고침
    } catch(e) {
        alert("수정 실패: " + e.message);
    }
}

// 👉 엑셀형 일괄 수정(Inline Edit) 상태 제어 변수
let isGlobalEditMode = false;

// 👉 일괄 수정 모드 켜기/끄기
function toggleGlobalEditMode() {
    isGlobalEditMode = !isGlobalEditMode;
    const btn = document.getElementById('global-edit-btn');
    
    // 화면에 보이는 텍스트(span)와 숨겨진 입력창(input)을 모두 가져옵니다.
    const nameSpans = document.querySelectorAll('.display-name');
    const nameInputs = document.querySelectorAll('.edit-name-input');
    const weightSpans = document.querySelectorAll('.display-weight');
    const weightInputs = document.querySelectorAll('.edit-weight-input');

    if (isGlobalEditMode) {
        // 수정 모드로 변신!
        btn.innerHTML = "💾 변경사항 저장하기";
        btn.style.background = "#10b981"; // 초록색으로 변경
        
        nameSpans.forEach(el => el.style.display = 'none');
        nameInputs.forEach(el => el.style.display = 'inline-block');
        weightSpans.forEach(el => el.style.display = 'none');
        weightInputs.forEach(el => el.style.display = 'inline-block');
    } else {
        // 저장 모드 돌입!
        btn.innerHTML = "⏳ DB에 저장 중...";
        btn.disabled = true;
        saveGlobalEdits(nameInputs, weightInputs);
    }
}

// 👉 수정된 내용을 DB에 저장하는 함수 (일괄 수정 버전)
async function saveGlobalEdits(nameInputs, weightInputs) {
    try {
        const docRef = db.collection('user_projects').doc(currentProjectId);
        const doc = await docRef.get();
        
        if (doc.exists) {
            let assessments = doc.data().assessments;

            nameInputs.forEach((input, i) => {
                const idx = parseInt(input.getAttribute('data-idx'));
                const newName = input.value.trim();
                const newWeight = parseFloat(weightInputs[i].value) || 0;
                const oldWeight = assessments[idx].weight || 0;

                if (newName) assessments[idx].name = newName;
                
                // 💡 변경된 비율에 맞춰 자동 비례 계산 적용
                if (oldWeight !== newWeight && oldWeight > 0 && assessments[idx].scores) {
                    const ratio = newWeight / oldWeight;
                    assessments[idx].scores.A *= ratio;
                    assessments[idx].scores.B *= ratio;
                    assessments[idx].scores.C *= ratio;
                    assessments[idx].scores.D *= ratio;
                    assessments[idx].scores.E *= ratio;
                }
                
                assessments[idx].weight = newWeight;
            });

            await docRef.update({ assessments: assessments });
            alert("✅ 모든 평가명과 반영 비율이 일괄 수정되었으며, 최종 점수도 새 비율에 맞게 자동 갱신되었습니다!");
        }
    } catch (e) {
        alert("수정 실패: " + e.message);
    } finally {
        isGlobalEditMode = false;
        loadProjectDetails(); // 표 다시 예쁘게 그리기
    }
}

async function saveBankAndApplyTable() {
    if (!confirm("데이터베이스에 문항을 안전하게 저장하고 표에 반영하시겠습니까?\n(취소를 누르면 이전 화면으로 멈춰있습니다.)")) { return; }
    await transformAndSaveExamToBank(true); // <--- 여기에 true 추가!
    await sendAiResultsToTable(true); 
}


// ✨ [신규 추가] 과거 유사 문항 판정 데이터(RAG) 50개 불러오기 함수
async function fetchReferenceQuestions(subjectCode) {
    try {
        // 현재 과목의 과거 기출/변형 문항을 최대 50개까지 가져옵니다.
        const snapshot = await db.collection('transformed_bank')
                                 .where('subject', '==', subjectCode)
                                 .limit(50)
                                 .get();
                                 
        if (snapshot.empty) return ""; // 데이터가 없으면 빈 칸 반환

        let refText = "\n<과거 AI 판정 참고 데이터베이스 (일관성 유지용)>\n";
        snapshot.forEach(doc => {
            const data = doc.data();
            refText += `[과거 문항] ${data.question}\n[과거 판정 수준] ${data.level}\n[과거 판정 이유] ${data.reason}\n---\n`;
        });
        refText += "</과거 AI 판정 참고 데이터베이스>\n";
        
        return refText;
    } catch (e) {
        console.warn("참고 데이터 불러오기 실패:", e);
        return "";
    }
}

// ✨ [신규 추가] 문항 매칭 이의 제기 창 열기
function openSpecificFeedbackPanel() {
    const question = currentQuestions[currentLevelQ];
    if (!question) return;

    const panel = document.getElementById('specific-feedback-panel');
    panel.style.display = 'flex';

    // 1. 현재 문항 정보 채워넣기 (화면에서 수식 렌더링 무시하고 글자만 추출)
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = question.q;
    document.getElementById('fb-current-q').innerText = tempDiv.innerText;
    document.getElementById('fb-current-std').innerText = currentStandardCode;
    document.getElementById('fb-current-level').innerText = question.level;

    // 2. 성취기준 드롭다운 목록 만들기 (현재 선택된 과목 기준)
    const stdSelect = document.getElementById('fb-proposed-std');
    stdSelect.innerHTML = '';
    if (subjectData[currentSubject] && subjectData[currentSubject].standards) {
        subjectData[currentSubject].standards.forEach(std => {
            const opt = document.createElement('option');
            opt.value = std.code;
            opt.innerText = `${std.code} ${std.desc.substring(0, 15)}...`;
            // 기본값은 현재 성취기준으로 세팅
            if (std.code === currentStandardCode) opt.selected = true;
            stdSelect.appendChild(opt);
        });
    }

    // 3. 상태 초기화
    document.getElementById('fb-proposed-level').value = question.level;
    document.getElementById('fb-reason').value = '';
    document.getElementById('fb-submit-btn').style.display = 'block';
    document.getElementById('fb-loading-msg').style.display = 'none';
}

async function submitSpecificFeedback() {
    const proposedStd = document.getElementById('fb-proposed-std').value;
    const proposedLevel = document.getElementById('fb-proposed-level').value;
    const reason = document.getElementById('fb-reason').value.trim();
    const questionText = currentQuestions[currentLevelQ].q;

    if (!reason) {
        alert("이의 제기를 위한 판정 이유를 작성해주세요.");
        return;
    }

    document.getElementById('fb-submit-btn').style.display = 'none';
    document.getElementById('fb-loading-msg').style.display = 'block';

    try {
        const workerUrl = "https://script.google.com/macros/s/AKfycbwgx4RgF8FQxxL3jBgEQ5l369llADjhZ1NepulIdF4DdX18kBrB8oRQ4Ft0d5WdKtEF/exec";
        const userApiKey = localStorage.getItem('gemini_api_key');
        
        const response = await fetch(workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: "review",
                questionText: questionText,
                currentStandardCode: currentStandardCode,
                currentLevel: currentQuestions[currentLevelQ].level,
                proposedStd: proposedStd,
                proposedLevel: proposedLevel,
                reason: reason,
                subject: detectSubjectIdFromStandardCode(currentStandardCode),
                apiKey: userApiKey
            })
        });

        if (!response.ok) throw new Error("백엔드 서버 통신 실패");
        const data = await response.json();

        // 🚀 [추가된 핵심 방어막] 에러 발생 시 무너지지 않고 원인 출력
        if (data.error) {
            const errMsg = typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error));
            throw new Error(`AI 통신 에러: ${errMsg}`);
        }
        if (!data.candidates || data.candidates.length === 0 || !data.candidates[0].content) {
            throw new Error("AI가 검토 결과를 정상적으로 생성하지 못했습니다. (안전 필터 또는 모델 응답 거부)");
        }

        const aiReviewText = data.candidates[0].content.parts[0].text;
        
        const user = auth.currentUser;
        const userEmail = user ? user.email : "이메일 정보 없음";
        
        const feedbackData = {
            type: "문항 매칭 이의 제기",
            bank_doc_id: currentQuestions[currentLevelQ].id,
            question: questionText,
            original_standard: currentStandardCode,
            original_level: currentQuestions[currentLevelQ].level,
            proposed_standard: proposedStd,
            proposed_level: proposedLevel,
            teacher_reason: reason,
            ai_review: aiReviewText,
            user_email: userEmail,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        await db.collection('developer_feedback').add(feedbackData);
        alert("✅ 선생님의 분석과 AI의 심층 검토 결과가 시스템에 접수되었습니다! (관리자 페이지의 '의견확인'에서 조회 가능합니다)");
        document.getElementById('specific-feedback-panel').style.display = 'none';

    } catch (e) {
        alert("🚨 의견 전송 중 오류가 발생했습니다:\n" + e.message);
    } finally {
        document.getElementById('fb-submit-btn').style.display = 'block';
        document.getElementById('fb-loading-msg').style.display = 'none';
    }
}
// ✨ [신규 추가] 수행평가 하위 평가요소 줄 동적 생성 및 삭제, 실시간 자동 합산 엔진
function addSubFactorRow(savedData = null) {
    const container = document.getElementById('sub-factors-list');
    const rowId = 'sub-factor-' + Date.now() + Math.random().toString(36).substr(2, 5);
    
    const row = document.createElement('div');
    row.id = rowId;
    row.className = 'sub-factor-row';
    row.style.cssText = "background: #fbf7ff; border: 1px solid #e9d5ff; padding: 12px; border-radius: 8px; display: flex; flex-direction: column; gap: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.02);";
    
    row.innerHTML = `
        <div style="display: flex; gap: 8px; align-items: center;">
            <input type="text" class="sub-factor-name" placeholder="요소명 (예: 가)" value="${savedData ? savedData.name : ''}" style="flex: 2; padding: 5px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 0.85rem;">
            <input type="number" class="sub-factor-max" placeholder="배점" value="${savedData ? savedData.max : ''}" style="flex: 1; padding: 5px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 0.85rem; text-align: center;">
            <button type="button" onclick="removeSubFactorRow('${rowId}')" style="background: #fee2e2; color: #ef4444; border: 1px solid #fca5a5; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8rem; font-weight: bold;">삭제</button>
        </div>
        <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; text-align: center; font-size: 0.8rem; color:#475569; font-weight: bold;">
            <div>A<input type="number" class="sub-a" value="${savedData ? savedData.a : ''}" oninput="calculateSubFactorsTotal()" style="width:100%; padding:4px; text-align:center; border:1px solid #cbd5e1; border-radius:4px; margin-top:2px;"></div>
            <div>B<input type="number" class="sub-b" value="${savedData ? savedData.b : ''}" oninput="calculateSubFactorsTotal()" style="width:100%; padding:4px; text-align:center; border:1px solid #cbd5e1; border-radius:4px; margin-top:2px;"></div>
            <div>C<input type="number" class="sub-c" value="${savedData ? savedData.c : ''}" oninput="calculateSubFactorsTotal()" style="width:100%; padding:4px; text-align:center; border:1px solid #cbd5e1; border-radius:4px; margin-top:2px;"></div>
            <div>D<input type="number" class="sub-d" value="${savedData ? savedData.d : ''}" oninput="calculateSubFactorsTotal()" style="width:100%; padding:4px; text-align:center; border:1px solid #cbd5e1; border-radius:4px; margin-top:2px;"></div>
            <div>E<input type="number" class="sub-e" value="${savedData ? savedData.e : ''}" oninput="calculateSubFactorsTotal()" style="width:100%; padding:4px; text-align:center; border:1px solid #cbd5e1; border-radius:4px; margin-top:2px;"></div>
        </div>
    `;
    container.appendChild(row);
    calculateSubFactorsTotal();
}


// =========================================================================
// 🎯 [수행평가 전용] 협업, 블라인드 처리, 분할점수 저장 통합 로직
// =========================================================================

let isManualCompareMode = false; // 비교하기(토글) 상태 추적 변수
let manualWorkspaceUnsubscribe = null; // 🟢 [추가] 수행평가 전용 CCTV (실시간 감시) 스위치 변수

// 1. 수행평가 작업 공간 초기화 (해당 평가를 클릭했을 때 실행해주세요)
async function loadManualAssessmentWorkspace() {
    if (!currentProjectId || currentEditingAssessmentIndex === -1) return;
    
    const docRef = db.collection('user_projects').doc(currentProjectId);

    // 💡 [기존 로직 완벽 보존] 내 데이터는 최초 1회만 고정해서 불러옵니다.
    try {
        const doc = await docRef.get();
        if (!doc.exists) return;

        const projectData = doc.data();
        const asm = projectData.assessments[currentEditingAssessmentIndex];
        const myEmail = auth.currentUser.email;

        isManualCompareMode = false; // 진입 시 무조건 비교창 닫음(가림) 상태로 초기화

        // 내 기존 점수 불러오기
        if (asm.teacherManualScores && asm.teacherManualScores[myEmail]) {
            const mySaved = asm.teacherManualScores[myEmail];
            document.getElementById('manual-a').value = mySaved.A; // 💡수정됨
            document.getElementById('manual-b').value = mySaved.B; // 💡수정됨
            document.getElementById('manual-c').value = mySaved.C; // 💡수정됨
            document.getElementById('manual-d').value = mySaved.D; // 💡수정됨
            document.getElementById('manual-e').value = mySaved.E; // 💡수정됨
            lockManualInputs(true); // 이미 저장했다면 잠금
            document.getElementById('btn-save-manual').innerHTML = "✅ 저장 완료";
            document.getElementById('btn-save-manual').style.background = "#10b981";
        } else {
            lockManualInputs(false);
            document.getElementById('btn-save-manual').innerHTML = "💾 결과 저장하기";
            document.getElementById('btn-save-manual').style.background = "#ea580c";
        }

        renderPartnerManualData(asm, projectData);
        updateManualTableStatus(asm, projectData);
    } catch (e) {
        console.error("수행평가 로드 실패:", e);
    }

    // 💡 [최적화 & 실시간 반영 추가] 
    // 기존에 켜진 CCTV가 있다면 끄고, 새로 켭니다.
    if (manualWorkspaceUnsubscribe) {
        manualWorkspaceUnsubscribe();
    }

    // 이제 이 공간(수행평가 창)에 있는 동안, 상대방이 저장을 누르면 '대기->완료'로 실시간 자동 변경됩니다!
    manualWorkspaceUnsubscribe = docRef.onSnapshot((doc) => {
        if (!doc.exists) return;
        const projectData = doc.data();
        const asm = projectData.assessments[currentEditingAssessmentIndex];

        // ⚠️ 내 텍스트 박스는 건드리지 않고(타이핑 방해 금지), 오직 '상대방 데이터'와 '대기/완료 현황판'만 업데이트!
        renderPartnerManualData(asm, projectData);
        updateManualTableStatus(asm, projectData);
    });
}

// 2. 상단 현황판 업데이트 및 [비교하기] 활성화
function updateManualTableStatus(asm, projectData) {
    const infoZone = document.getElementById('current-manual-assessment-info');
    const compareBtn = document.getElementById('btn-compare-manual');
    const myEmail = auth.currentUser.email;
    if (!infoZone || !asm) return;

    let allMembers = projectData.collaborators || [];
    if (projectData.ownerEmail && !allMembers.includes(projectData.ownerEmail)) allMembers.unshift(projectData.ownerEmail);
    if (!allMembers.includes(myEmail)) allMembers.push(myEmail);
    const collaborators = [...new Set(allMembers)];

    let missingTeachers = [];
    let statusHTML = `<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;">`;

    collaborators.forEach(email => {
        const name = email.split('@')[0];
        if (asm.teacherManualScores && asm.teacherManualScores[email]) {
            statusHTML += `<span style="background: #dcfce7; color: #166534; padding: 4px 8px; border-radius: 4px; border: 1px solid #86efac; font-size: 0.8rem; font-weight: bold;">✅ ${name}: 완료</span>`;
        } else {
            missingTeachers.push(name);
            statusHTML += `<span style="background: #f1f5f9; color: #64748b; padding: 4px 8px; border-radius: 4px; border: 1px solid #e2e8f0; font-size: 0.8rem; font-weight: bold;">⏳ ${name}: 대기</span>`;
        }
    });
    statusHTML += `</div>`;

    const isFinal = (missingTeachers.length === 0);
    const amIComplete = (asm.teacherManualScores && asm.teacherManualScores[myEmail]);

    let titleHtml = `<div style="color:#1e3a8a; font-size:1.1rem; font-weight:900; margin-bottom:5px;">📌 [수행] ${asm.name} (${asm.weight}%)</div>`;

    if (isFinal) {
        infoZone.innerHTML = titleHtml + `<div style="color:#166534; font-size:0.9rem; font-weight:bold;">🎉 모든 교사 수행평가 산출 완료!</div>` + statusHTML;
        infoZone.style.background = "#f0fdf4"; infoZone.style.border = "2px solid #22c55e";
        if (compareBtn) {
            compareBtn.disabled = false;
            compareBtn.style.cursor = "pointer";
            compareBtn.innerHTML = isManualCompareMode ? "🙈 양쪽 비교 닫기" : "📊 비교하기 (활성)";
            compareBtn.style.background = isManualCompareMode ? "#6366f1" : "#8b5cf6";
        }
    } else if (amIComplete) {
        infoZone.innerHTML = titleHtml + `<div style="color:#92400e; font-size:0.9rem; font-weight:bold;">💾 내 저장 완료! (다른 교사 대기중)</div>` + statusHTML;
        infoZone.style.background = "#fffbeb"; infoZone.style.border = "2px solid #f59e0b";
        if (compareBtn) { compareBtn.disabled = true; compareBtn.style.background = "#94a3b8"; compareBtn.style.cursor = "not-allowed"; compareBtn.innerHTML = "📊 비교하기 (대기)"; }
    } else {
        infoZone.innerHTML = titleHtml + `<div style="color:#334155; font-size:0.9rem; font-weight:bold;">👥 수행평가 작업 현황</div>` + statusHTML;
        infoZone.style.background = "#f8fafc"; infoZone.style.border = "1px solid #cbd5e1";
        if (compareBtn) { compareBtn.disabled = true; compareBtn.style.background = "#94a3b8"; compareBtn.style.cursor = "not-allowed"; compareBtn.innerHTML = "📊 비교하기 (대기)"; }
    }
}

// 3. 우측 팀원 영역 렌더링 (블라인드 🔒 및 토글 적용)
function renderPartnerManualData(asm, projectData) {
    const container = document.getElementById('partner-manual-fields-container');
    if (!container) return;

    let allMembers = projectData.collaborators || [];
    if (projectData.ownerEmail && !allMembers.includes(projectData.ownerEmail)) allMembers.unshift(projectData.ownerEmail);
    const myEmail = auth.currentUser.email;
    const partnerEmails = allMembers.filter(email => email !== myEmail);

    if (partnerEmails.length === 0) {
        container.innerHTML = `<p style="text-align:center; margin-top:2rem; color:#94a3b8;">초대된 팀원이 없습니다 (단독 작업)</p>`;
        return;
    }

    let html = '';
    partnerEmails.forEach(email => {
        const name = email.split('@')[0];
        const scores = asm.teacherManualScores ? asm.teacherManualScores[email] : null;
        const structure = asm.teacherManualStructures ? asm.teacherManualStructures[email] : null;

        html += `<div style="background: #f8fafc; border: 1px solid #cbd5e1; padding: 12px; border-radius: 8px; margin-bottom: 15px;">
            <div style="font-weight: bold; color: #1e3a8a; border-bottom: 1px dashed #cbd5e1; padding-bottom: 5px; margin-bottom: 8px;">👤 ${name} 선생님</div>`;

        if (!scores) {
            html += `<p style="color: #94a3b8; font-style: italic; font-size:0.9rem;">⏳ 입력 대기 중...</p></div>`;
        } else if (!isManualCompareMode) {
            // 🔒 모두 완료했으나 아직 비교하기를 안 누른 상태 (블라인드)
            html += `
                <div style="text-align:center; padding: 15px; background: #ecfdf5; border: 1px dashed #10b981; border-radius: 6px;">
                    <span style="color: #047857; font-weight: bold;">✅ 입력완료 🔒</span><br>
                    <span style="font-size: 0.75rem; color: #065f46; display: block; margin-top: 5px;">(모든 교사 완료 후 [비교하기] 클릭 시 공개)</span>
                </div></div>`;
        } else {
            // 🔓 비교하기 눌렀을 때 (오픈)
            if (structure && structure.length > 0) {
                html += `<div style="font-size:0.8rem; background:#ffffff; border:1px solid #e2e8f0; padding:6px; border-radius:4px; margin-bottom:8px;">
                    <strong>📐 구조:</strong> ` + structure.map(s => `${s.domainName}(${s.subElements.join('+')})`).join(', ') + `</div>`;
            }
            html += `
                <div style="display: flex; gap: 4px; font-size: 0.85rem; text-align: center;">
                    <span style="flex:1; background:#fee2e2; color:#b91c1c; padding:6px 2px; border-radius:4px; font-weight:bold;">A:${scores.A}</span>
                    <span style="flex:1; background:#fef3c7; color:#b45309; padding:6px 2px; border-radius:4px; font-weight:bold;">B:${scores.B}</span>
                    <span style="flex:1; background:#dcfce7; color:#15803d; padding:6px 2px; border-radius:4px; font-weight:bold;">C:${scores.C}</span>
                    <span style="flex:1; background:#dbeafe; color:#1d4ed8; padding:6px 2px; border-radius:4px; font-weight:bold;">D:${scores.D}</span>
                    <span style="flex:1; background:#f1f5f9; color:#475569; padding:6px 2px; border-radius:4px; font-weight:bold;">E:${scores.E}</span>
                </div></div>`;
        }
    });
    container.innerHTML = html;
}

// 4. 비교하기(토글) 버튼 클릭 시 실행
async function toggleManualCompareMode() {
    isManualCompareMode = !isManualCompareMode;
    // 상태만 바꾼 뒤 작업공간 리로드 (DB 새로 안 부르고 화면만 다시 그림)
    if (!currentProjectId || currentEditingAssessmentIndex === -1) return;
    const doc = await db.collection('user_projects').doc(currentProjectId).get();
    if(doc.exists) {
        const projectData = doc.data();
        const asm = projectData.assessments[currentEditingAssessmentIndex];
        renderPartnerManualData(asm, projectData);
        updateManualTableStatus(asm, projectData);
    }
}

// 5. 결과 저장 (새로 만들기 & 기존 수정 완벽 통합)
async function saveManualAssessmentToProject() {
    // 💡 1. 인덱스가 -1일 때 튕겨내는 방어막을 제거해야 '신규 생성'이 가능합니다.
    if (!currentProjectId) {
        alert("선택된 프로젝트가 없습니다. 폴더를 다시 열어주세요.");
        return;
    }

    // 💡 2. 평가명과 반영 비율을 가장 먼저 확인합니다.
    const name = document.getElementById('manual-assess-name').value.trim();
    const weight = parseFloat(document.getElementById('manual-assess-weight').value) || 0;
    
    if (!name) {
        alert("수행평가 이름(예: 포트폴리오 평가)을 입력해 주세요.");
        return;
    }

    // 💡 3. 괄호를 밖으로 빼서 빈칸/문자 입력 시 화면이 멈추는(NaN 에러) 현상을 원천 차단했습니다.
    const vA = parseFloat(document.getElementById('manual-a').value) || 0;
    const vB = parseFloat(document.getElementById('manual-b').value) || 0;
    const vC = parseFloat(document.getElementById('manual-c').value) || 0;
    const vD = parseFloat(document.getElementById('manual-d').value) || 0;
    const vE = parseFloat(document.getElementById('manual-e').value) || 0;

    if (vA === 0 && vB === 0 && vC === 0 && vD === 0 && vE === 0) { 
        alert("산출된 최종 분할점수를 하나 이상 입력해 주세요."); 
        return; 
    }

    const saveBtn = document.getElementById('btn-save-manual');
    const originalBtnText = saveBtn.innerHTML;
    saveBtn.innerHTML = "⏳ 저장 중..."; 
    saveBtn.disabled = true;

    // 💡 4. 선생님이 만드신 하위 평가요소(가,나,다) 줄의 내용들을 배열로 모아줍니다.
    let subFactors = [];
    document.querySelectorAll('.sub-factor-row').forEach(row => {
        subFactors.push({
            name: row.querySelector('.sub-factor-name').value,
            max: parseFloat(row.querySelector('.sub-factor-max').value) || 0,
            a: parseFloat(row.querySelector('.sub-a').value) || 0,
            b: parseFloat(row.querySelector('.sub-b').value) || 0,
            c: parseFloat(row.querySelector('.sub-c').value) || 0,
            d: parseFloat(row.querySelector('.sub-d').value) || 0,
            e: parseFloat(row.querySelector('.sub-e').value) || 0
        });
    });

    try {
        const docRef = db.collection('user_projects').doc(currentProjectId);
        const doc = await docRef.get();
        
        if (doc.exists) {
            let projectData = doc.data();
            let assessments = projectData.assessments || [];
            const currentUserEmail = auth.currentUser.email;

            let asm;
            
            // 💡 5. 핵심 로직: 신규 생성이면 배열에 새로 밀어넣고(-1), 기존 것이면 덮어씁니다!
            if (currentEditingAssessmentIndex === -1) {
                // [신규 생성 모드]
                asm = {
                    name: name,
                    weight: weight,
                    type: 'manual',
                    subFactors: subFactors,
                    teacherManualScores: {},
                    savedAt: new Date()
                };
                assessments.push(asm);
                // 방금 새로 만든 요소의 번호(배열의 맨 끝)로 인덱스를 업데이트 해줍니다.
                currentEditingAssessmentIndex = assessments.length - 1; 
            } else {
                // [기존 수정 모드]
                asm = assessments[currentEditingAssessmentIndex];
                asm.name = name;
                asm.weight = weight;
                asm.subFactors = subFactors; 
            }

            // 내 점수 기록하기
            if (!asm.teacherManualScores) asm.teacherManualScores = {};
            asm.teacherManualScores[currentUserEmail] = { A:vA, B:vB, C:vC, D:vD, E:vE };

            // 협업 완료 현황 확인
            let allMembers = projectData.collaborators || [];
            if (projectData.ownerEmail && !allMembers.includes(projectData.ownerEmail)) allMembers.unshift(projectData.ownerEmail);
            if (!allMembers.includes(currentUserEmail)) allMembers.push(currentUserEmail);
            const collaborators = [...new Set(allMembers)];

            let isFinal = collaborators.every(email => asm.teacherManualScores[email]);

            // 모두 입력했다면 최종 점수 합산 반영
            if (isFinal) {
                let avg = { A:0, B:0, C:0, D:0, E:0 };
                collaborators.forEach(email => {
                    avg.A += asm.teacherManualScores[email].A; 
                    avg.B += asm.teacherManualScores[email].B;
                    avg.C += asm.teacherManualScores[email].C; 
                    avg.D += asm.teacherManualScores[email].D; 
                    avg.E += asm.teacherManualScores[email].E;
                });
                const cnt = collaborators.length;
                const finalWeight = asm.weight || 100;
                asm.scores = { 
                    A: (avg.A/cnt)*(finalWeight/100), 
                    B: (avg.B/cnt)*(finalWeight/100), 
                    C: (avg.C/cnt)*(finalWeight/100), 
                    D: (avg.D/cnt)*(finalWeight/100), 
                    E: (avg.E/cnt)*(finalWeight/100) 
                };
                alert("✅ 수행평가 산출 완료! 평균 점수가 목록에 반영되었습니다.");
            } else {
                if(asm.scores) delete asm.scores;
                alert("✅ 내 점수가 저장되었습니다. 다른 교사가 완료하면 최종 산출됩니다.");
            }

            // DB에 최종 덮어쓰기!
            await docRef.update({ assessments: assessments });
            
            saveBtn.innerHTML = "✅ 저장 완료";
            saveBtn.style.background = "#10b981";
            
            // 뒤에 깔려있는 메인 목록과 현재 수행평가 작업판 모두 갱신 (선생님이 찾으시던 마지막 부분입니다!)
            if(typeof loadProjectDetails === 'function') loadProjectDetails(); 
            loadManualAssessmentWorkspace(); 
        }
    } catch(e) {
        console.error("수행평가 저장 에러:", e);
        alert("저장 실패: " + e.message);
        saveBtn.innerHTML = originalBtnText; 
        saveBtn.disabled = false;
    }
}


// 6. 수정하기
async function enableManualEditMode() {
    if (!currentProjectId || currentEditingAssessmentIndex === -1) return;

    // 기존 기능 유지 (화면 잠금 해제 및 버튼 원래대로)
    lockManualInputs(false);
    const saveBtn = document.getElementById('btn-save-manual');
    saveBtn.innerHTML = "💾 결과 저장하기";
    saveBtn.style.background = "#ea580c";
    saveBtn.disabled = false;
    saveBtn.style.cursor = "pointer";

    // ✨ [추가된 부분] DB에서 내 완료 기록을 임시 삭제하여 '대기' 상태로 전환
    try {
        const docRef = db.collection('user_projects').doc(currentProjectId);
        const doc = await docRef.get();
        if (doc.exists) {
            let projectData = doc.data();
            let asm = projectData.assessments[currentEditingAssessmentIndex];
            const myEmail = auth.currentUser.email;

            // 내 완료 기록 삭제 및 누군가 수정중이므로 최종 점수(scores) 블라인드 처리
            if (asm.teacherManualScores) delete asm.teacherManualScores[myEmail];
            if (asm.scores) delete asm.scores; 

            await docRef.update({ assessments: projectData.assessments });
            
            // 현황판 즉시 '대기'로 새로고침
            updateManualTableStatus(asm, projectData);
            if (typeof loadProjectDetails === 'function') loadProjectDetails();
        }
    } catch(e) { console.error("수정 모드 에러:", e); }
}

// 7. 초기화하기
async function resetManualScores() {
    if(!confirm("저장된 내 수행평가 결과를 완전히 초기화하시겠습니까?")) return;
    if(!currentProjectId || currentEditingAssessmentIndex === -1) return;

    try {
        const docRef = db.collection('user_projects').doc(currentProjectId);
        const doc = await docRef.get();
        if(doc.exists) {
            let projectData = doc.data();
            let asm = projectData.assessments[currentEditingAssessmentIndex];
            const myEmail = auth.currentUser.email;

            // 기존 로직 유지 (DB 내용 완전 삭제)
            if(asm.teacherManualScores) delete asm.teacherManualScores[myEmail];
            if(asm.teacherManualStructures) delete asm.teacherManualStructures[myEmail];
            if(asm.scores) delete asm.scores;

            await docRef.update({ assessments: projectData.assessments });
            
            // ✨ [보강된 부분] 화면의 모든 입력칸을 깔끔하게 비우고 버튼 되돌리기
            document.querySelectorAll('.my-manual-score-input').forEach(i => {
                i.value = ''; 
            });
            lockManualInputs(false); // 잠금 해제
            document.getElementById('sub-factors-list').innerHTML = ''; // 하위 요소 줄 비우기
            
            const saveBtn = document.getElementById('btn-save-manual');
            saveBtn.innerHTML = "💾 결과 저장하기";
            saveBtn.style.background = "#ea580c";
            saveBtn.disabled = false;
            saveBtn.style.cursor = "pointer";

            alert("🗑️ 초기화 완료! 다시 입력해주세요.");
            
            // 현황판 즉시 새로고침
            updateManualTableStatus(asm, projectData);
            if (typeof loadProjectDetails === 'function') loadProjectDetails();
            loadManualAssessmentWorkspace();
        }
    } catch(e) { alert("초기화 실패: "+e.message); }
}

// 8. 구조 동기화 (버튼 클릭 시)
async function syncManualStructureFromDB() {
    if (!currentProjectId || currentEditingAssessmentIndex === -1) return;
    try {
        const doc = await db.collection('user_projects').doc(currentProjectId).get();
        const asm = doc.data().assessments[currentEditingAssessmentIndex];
        if (asm.manualStructure && asm.manualStructure.length > 0) {
            alert("🔄 [기능연결 필요] 팀원이 저장한 구조를 불러왔습니다. 선생님의 UI 생성 함수를 이곳에 연결해 주세요.");
            console.log("불러온 구조:", asm.manualStructure);
            // 💡 여기에 선생님의 수행평가 UI 생성 함수(예: addDomainUI)를 호출하여 asm.manualStructure 데이터를 넣어주시면 됩니다.
        } else {
            alert("💡 연동할 구조가 아직 없습니다.");
        }
    } catch(e) { console.error(e); }
}

// 9. 잠금 제어 유틸
function lockManualInputs(isLock) {
    document.querySelectorAll('.my-manual-score-input, .manual-domain-input, .manual-sub-input').forEach(input => {
        input.disabled = isLock;
        input.style.background = isLock ? "#f1f5f9" : "#ffffff";
    });
}

function removeSubFactorRow(rowId) {
    const row = document.getElementById(rowId);
    if (row) row.remove();
    calculateSubFactorsTotal();
}

function calculateSubFactorsTotal() {
    const rows = document.querySelectorAll('.sub-factor-row');
    const mainInputs = document.querySelectorAll('#manual-assessment-modal .main-cut-input');
    
    if (rows.length === 0) {
        // 하위 요소가 없으면 기존 수동 입력창 해제
        mainInputs.forEach(input => {
            input.readOnly = false;
            input.style.background = 'white';
        });
        return;
    }

    // 하위 요소들의 등급별 점수를 실시간 누적 합산
    let totals = { a: 0, b: 0, c: 0, d: 0, e: 0 };
    rows.forEach(row => {
        totals.a += parseFloat(row.querySelector('.sub-a').value) || 0;
        totals.b += parseFloat(row.querySelector('.sub-b').value) || 0;
        totals.c += parseFloat(row.querySelector('.sub-c').value) || 0;
        totals.d += parseFloat(row.querySelector('.sub-d').value) || 0;
        totals.e += parseFloat(row.querySelector('.sub-e').value) || 0;
    });

    // 메인 최종 컷오프 인풋창에 합산값 대입 및 입력 방지 잠금
    document.getElementById('manual-a').value = totals.a || '';
    document.getElementById('manual-b').value = totals.b || '';
    document.getElementById('manual-c').value = totals.c || '';
    document.getElementById('manual-d').value = totals.d || '';
    document.getElementById('manual-e').value = totals.e || '';

    mainInputs.forEach(input => {
        input.readOnly = true;
        input.style.background = '#f1f5f9'; // 자동 완성되었음을 시각적으로 암시
    });
}

// ✨ 3. 화면에 있는 입력창 값들을 그대로 읽어와서 진짜 DB를 수정하는 마법의 함수
async function acceptFeedback(feedbackId) {
    if(!confirm("현재 화면에 입력된 내용(기준, 수준, 정답, 이유)으로\n문제은행(DB)을 즉시 수정하시겠습니까?")) return;
    
    try {
        const feedbackDoc = await db.collection('developer_feedback').doc(feedbackId).get();
        if (!feedbackDoc.exists) return;
        const fbData = feedbackDoc.data();
        
        // ✨ 화면에서 관리자가 최종 확인/수정한 4가지 데이터를 모두 가져옵니다.
        const finalStd = document.getElementById(`admin-prop-std-${feedbackId}`).value.trim();
        const finalLvl = document.getElementById(`admin-prop-lvl-${feedbackId}`).value.trim();
        const finalAns = document.getElementById(`admin-prop-ans-${feedbackId}`).value.trim();
        const finalReason = document.getElementById(`admin-prop-reason-${feedbackId}`).value.trim();
        
        // 💡 텍스트 검색 대신, 저장해둔 고유 ID로 원본 문항에 다이렉트 접근
        if (!fbData.bank_doc_id) {
            alert("오류: 원본 문항의 고유 식별 코드가 누락되었습니다. (이전 방식의 피드백일 수 있습니다.)");
            return;
        }

        const targetDocRef = db.collection('transformed_bank').doc(fbData.bank_doc_id);
        const targetDoc = await targetDocRef.get();

        if (!targetDoc.exists) {
            alert("원본 문항을 찾을 수 없습니다. (이미 삭제된 문항일 수 있습니다.)");
            return;
        }
        
        // ✨ 해당 문항의 4가지 필드를 완벽하게 덮어씁니다.
        await targetDocRef.update({
            standard_code: finalStd,
            level: finalLvl,
            answer: finalAns,
            reason: finalReason
        });
        
        // 처리 완료된 피드백 기록 지우기
        await db.collection('developer_feedback').doc(feedbackId).delete();
        
        alert("✅ 관리자님의 검토 내용으로 문항 데이터가 성공적으로 수정되었습니다!");
        openAdminFeedback(); // 창 새로고침
        
    } catch (e) {
        alert("수락 처리 중 오류가 발생했습니다: " + e.message);
    }
}

// ✨ 4. 반려 기능
async function rejectFeedback(feedbackId) {
    if(!confirm("이 의견을 반려(삭제)하시겠습니까?")) return;
    try {
        await db.collection('developer_feedback').doc(feedbackId).delete();
        alert("🗑️ 의견이 반려되어 목록에서 삭제되었습니다.");
        openAdminFeedback(); // 창 새로고침
    } catch (e) {
        alert("반려 처리 중 오류가 발생했습니다: " + e.message);
    }
}

// 💡 [수정] 경고창(alert) 대신 수식(MathJax)이 완벽하게 렌더링되는 자체 모달창으로 교체!
function showAiReason(qIdx) {
    if (!parsedScores || !parsedScores[qIdx]) return;
    const q = parsedScores[qIdx];
    const reason = q.reason || "AI가 판정 이유를 응답하지 않았습니다.";

    // 기존에 열려있는 창이 있다면 닫기
    let oldModal = document.getElementById('ai-reason-custom-modal');
    if (oldModal) oldModal.remove();

    // 자체 디자인된 HTML 팝업창 생성
    const modalHtml = `
    <div id="ai-reason-custom-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 9999; display: flex; justify-content: center; align-items: center; backdrop-filter: blur(2px);">
        <div style="background: white; padding: 2rem; border-radius: 12px; max-width: 500px; width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
            <h3 style="margin-top: 0; margin-bottom: 1rem; color: #1e3a8a; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">
                💡 [문항 ${q.num}] AI 판정 이유
            </h3>
            <div style="background: #f8fafc; padding: 1.2rem; border-radius: 8px; border: 1px solid #cbd5e1; margin-bottom: 1.5rem; line-height: 1.7; max-height: 60vh; overflow-y: auto; font-size: 0.95rem; color: #334155;">
                ${reason.replace(/\n/g, '<br>')}
            </div>
            <div style="text-align: right;">
                <button onclick="document.getElementById('ai-reason-custom-modal').remove()" style="background: #3b82f6; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-weight: bold; transition: 0.2s;" onmouseover="this.style.background='#2563eb'" onmouseout="this.style.background='#3b82f6'">닫기</button>
            </div>
        </div>
    </div>`;

    // 화면 끝에 모달창 밀어넣기
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // ✨ 모달창이 화면에 뜬 직후, 그 안의 $$ 수식을 MathJax로 변환!
    if (window.MathJax && window.MathJax.typesetPromise) {
        MathJax.typesetPromise([document.getElementById('ai-reason-custom-modal')]).catch(err => console.error(err));
    }
}

// ==========================================
// 📚 [2탄] 성취기준 사전 (아코디언 및 자동 닫힘 로직)
// ==========================================

// 💡 일반 교사용: 최초 로그인 시 선택한 교과군 DB에 저장하기
async function saveUserSubjectGroup(group) {
    try {
        await db.collection('user_profiles').doc(auth.currentUser.uid).set({
            mainGroup: group,
            email: auth.currentUser.email,
            nickname: auth.currentUser.displayName || "사용자", // 👈 변수 없이 직접 할당
            timestamp: firebase.firestore.FieldValue.serverTimestamp() // 👈 여기에 가입/설정 시간이 자동 기록됩니다!
        }, { merge: true });

        currentUserGroup = group;
        document.getElementById('subject-selection-modal').style.display = 'none'; // 팝업 닫기
        
        // 💡 [수정됨] 화면 꿀렁임(점프)을 막고, 버튼만 숨긴 뒤 데이터만 부드럽게 갈아끼웁니다.
        document.querySelectorAll('.group-btn').forEach(btn => btn.style.display = 'none');
        
        changeGroup(group); 
        if (typeof initChecklist === 'function') initChecklist(); 
        if (typeof loadBookmark === 'function') loadBookmark(); 
        
        alert("✅ 담당 교과 설정이 완료되었습니다!");
    } catch(e) {
        alert("설정 저장 실패: " + e.message);
    }
}
// 💡 교과군 선택 창에서 X버튼이나 배경을 눌러 가입을 취소했을 때 실행되는 함수
function cancelSubjectSelection() {
    document.getElementById('subject-selection-modal').style.display = 'none';
    
    // 즉시 로그아웃 처리 후 화면을 새로고침하여 비로그인 상태로 깔끔하게 초기화합니다.
    auth.signOut().then(() => {
        alert("가입(로그인)이 취소되었습니다. 비로그인 상태로 돌아갑니다.");
        window.location.reload(); 
    }).catch(err => console.error("로그아웃 처리 중 에러 발생:", err));
}

// ==========================================
// 📚 [2탄] 성취기준 사전 (아코디언 및 드래그 로직)
// ==========================================

// 1️⃣ 사전을 드래그하기 위한 변수와 함수 (드래그 랙 완벽 해결)
let isDraggingDict = false;
let dictOffsetX = 0;
let dictOffsetY = 0;

function initDictionaryDrag() {
    const panel = document.getElementById('floating-dictionary-panel');
    const header = document.getElementById('dict-header'); 

    if (!panel || !header) return;

    header.addEventListener('mousedown', (e) => {
        isDraggingDict = true;
        const rect = panel.getBoundingClientRect();
        dictOffsetX = e.clientX - rect.left;
        dictOffsetY = e.clientY - rect.top;
        document.body.style.userSelect = 'none'; 
        
        // 🚀 [핵심 수정] 드래그 중에는 뚝뚝 끊기는 애니메이션을 강제로 꺼서 마우스에 찰싹 붙게 만듭니다!
        panel.style.transition = 'none'; 
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDraggingDict) return;
        panel.style.left = (e.clientX - dictOffsetX) + 'px';
        panel.style.top = (e.clientY - dictOffsetY) + 'px';
        panel.style.bottom = 'auto'; 
        panel.style.right = 'auto';  
    });

    document.addEventListener('mouseup', () => {
        if(isDraggingDict) {
            isDraggingDict = false;
            document.body.style.userSelect = 'auto';
            
            // 🚀 드래그가 끝나면 다시 애니메이션을 원래대로 켭니다.
            panel.style.transition = ''; 
        }
    });
}

// 💡 창 열기/닫기 (사용자 화면 과목과 100% 동기화 + 위치 리셋)
// 💡 창 열기/닫기 (사용자 화면 과목 세팅 - 선생님 원본 100% 복구 + 위치 리셋)
function toggleDictionaryPanel() {
    const panel = document.getElementById('floating-dictionary-panel');
    if (!panel) return;

    panel.classList.toggle('open'); 

    if (panel.classList.contains('open')) {
        const select = document.getElementById('dict-subject-select');
        
        if (currentUserRole === 'user') {
            // [일반 교사용] 상단 과목 탭만 숨기고, 로그인 시 선택한 교과군(currentUserGroup) 전체를 로드합니다!
            document.querySelectorAll('.dict-group-btn').forEach(btn => btn.style.display = 'none');
            changeDictGroup(currentUserGroup); 
        } else {
            // [관리자용] 탭을 보여주고, 빈 화면이면 수학을 기본으로 띄웁니다.
            document.querySelectorAll('.dict-group-btn').forEach(btn => btn.style.display = 'inline-block');
            if (select.options.length <= 1) {
                changeDictGroup('math'); 
            }
        }
    } else {
        // 창을 닫을 때 이리저리 옮겼던 위치를 원래 자리로 복구
        panel.style.left = '';
        panel.style.top = '';
        panel.style.bottom = ''; 
        panel.style.right = '';
    }
}

// 💡 교과군 변경 (선생님의 원본 1번 코드 100% - 모든 교과가 드롭다운에 나타납니다!)
function changeDictGroup(groupId) {
    document.querySelectorAll('.dict-group-btn').forEach(btn => btn.classList.remove('active'));
    const targetBtn = document.querySelector(`button[onclick="changeDictGroup('${groupId}')"]`);
    if(targetBtn) targetBtn.classList.add('active');
    
    const selectEl = document.getElementById('dict-subject-select');
    selectEl.innerHTML = '<option value="">-- 과목을 선택하세요 --</option>';
    
    if (!curriculumMap[groupId]) return;
    const map = curriculumMap[groupId];
    
    for (const category in map) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = category;
        
        map[category].forEach(sub => {
            const opt = document.createElement('option');
            opt.value = sub.id;
            
            // 🌟 데이터 유무에 따라 (준비중) 처리하는 선생님의 완벽한 원본 로직
            if (!subjectData || !subjectData[sub.id] || !subjectData[sub.id].standards || subjectData[sub.id].standards.length === 0) {
                opt.innerText = sub.name + " (준비중)";
                opt.disabled = true;
            } else {
                opt.innerText = sub.name;
            }
            optgroup.appendChild(opt);
        });
        selectEl.appendChild(optgroup);
    }
    
    // 강제 선택 로직 제거! 무조건 "-- 과목을 선택하세요 --" 상태에서 안내문구 출력
    document.getElementById('dict-accordion-container').innerHTML = '<p style="text-align:center; color:#64748b; font-size:0.95rem; margin-top:2rem;">위에서 과목을 선택하면<br>성취기준과 수준(A~E)이 나타납니다.</p>';
}

// 4️⃣ 과목을 선택하면 아코디언 목록 렌더링
function loadDictionaryStandards() {
    const subject = document.getElementById('dict-subject-select').value;
    const container = document.getElementById('dict-accordion-container');
    
    if (!subject) {
        container.innerHTML = '<p style="text-align:center; color:#64748b; font-size:0.95rem; margin-top:2rem;">과목을 선택하면 성취기준이 나타납니다.</p>';
        return;
    }

    const data = subjectData[subject];
    if (!data || !data.standards || data.standards.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#ef4444; font-size:0.95rem; margin-top:2rem;">이 과목에는 아직 등록된 성취기준 데이터가 없습니다.</p>';
        return;
    }

    const standards = data.standards;
    // 💡 중단원(category) 필드가 하나라도 입력되어 있는지 체크
    const hasCategory = standards.some(std => std.category && std.category.trim() !== "");

    let html = '';
    let globalIndex = 0; // 아코디언 토글을 위한 전체 고유 인덱스保持
    
    if (hasCategory) {
        // [A안] 중단원이 존재하는 경우: 카테고리별로 묶어줍니다.
        const groupedStandards = {};
        standards.forEach(std => {
            const cat = std.category || '미분류 단원';
            if (!groupedStandards[cat]) groupedStandards[cat] = [];
            groupedStandards[cat].push(std);
        });

        // 단원명을 추가하며 아코디언을 생성합니다.
        for (const category in groupedStandards) {
            html += `<div style="background:#e0e7ff; color:#1e40af; padding:8px 12px; border-radius:6px; font-weight:bold; font-size:0.9rem; margin-top:1.5rem; margin-bottom:10px;">📁 ${category}</div>`;
            
            groupedStandards[category].forEach(std => {
                html += buildAccordionItemHtml(std, globalIndex);
                globalIndex++;
            });
        }
    } else {
        // [B안] 중단원이 아예 없는 경우: 단원명 구분 없이 아코디언 리스트를 순서대로 나열
        standards.forEach(std => {
            html += buildAccordionItemHtml(std, globalIndex);
            globalIndex++;
        });
    }
    
    container.innerHTML = html;
    // 👇👇 [새로 추가된 부분] 화면에 데이터가 들어간 직후 MathJax 강제 변환 호출 👇👇
    if (window.MathJax) {
        setTimeout(() => {
            MathJax.typesetClear([container]);
            MathJax.typesetPromise([container]).catch(function (err) {
                console.error('사전 수식 렌더링 에러:', err);
            });
        }, 100); // 화면에 그려질 시간(0.1초)을 잠깐 준 뒤 변환 시작
    }
    // 👆👆 ----------------------------------------------------------- 👆👆
}

// 💡 기능 유실 방지를 위한 개별 아코디언 HTML 문자열 생성 함수
function buildAccordionItemHtml(std, globalIndex) {
    const lvlA = std.levels?.high || "데이터 없음";
    const lvlB = std.levels?.b || (std.levels?.high ? std.levels.high.replace("이해하여 설명할 수 있으며", "설명할 수 있고") : "데이터 없음");
    const lvlC = std.levels?.mid || "데이터 없음";
    const lvlD = std.levels?.d || (std.levels?.mid ? std.levels.mid.replace("이해하고", "알고") : "데이터 없음");
    const lvlE = std.levels?.low || "데이터 없음";

    return `
    <div class="dict-accordion-item">
        <button class="dict-accordion-header" onclick="toggleAccordion(${globalIndex})">
            <span style="flex:1; padding-right:10px;">${std.code}</span>
            <span id="acc-icon-${globalIndex}">▼</span>
        </button>
        
        <div id="acc-body-${globalIndex}" class="dict-accordion-body">
            <strong style="color:#1e40af; display:block; margin-bottom:12px; font-size:0.95rem;">${std.desc}</strong>
            <div style="background:#fef2f2; padding:8px; border-radius:4px; margin-bottom:4px; border-left:3px solid #ef4444;"><strong>[A]</strong> ${lvlA}</div>
            <div style="background:#fffbeb; padding:8px; border-radius:4px; margin-bottom:4px; border-left:3px solid #f59e0b;"><strong>[B]</strong> ${lvlB}</div>
            <div style="background:#f0fdf4; padding:8px; border-radius:4px; margin-bottom:4px; border-left:3px solid #22c55e;"><strong>[C]</strong> ${lvlC}</div>
            <div style="background:#eff6ff; padding:8px; border-radius:4px; margin-bottom:4px; border-left:3px solid #3b82f6;"><strong>[D]</strong> ${lvlD}</div>
            <div style="background:#f8fafc; padding:8px; border-radius:4px; border-left:3px solid #94a3b8;"><strong>[E]</strong> ${lvlE}</div>
        </div>
    </div>`;
}
// 5️⃣ 마법의 자동 닫힘 로직 (다른 걸 누르면 기존 건 닫힘)
function toggleAccordion(index) {
    const allHeaders = document.querySelectorAll('.dict-accordion-header');
    const allBodies = document.querySelectorAll('.dict-accordion-body');
    const allIcons = document.querySelectorAll('[id^="acc-icon-"]');
    
    const targetBody = document.getElementById(`acc-body-${index}`);
    const targetHeader = targetBody.previousElementSibling;
    const targetIcon = document.getElementById(`acc-icon-${index}`);

    const isCurrentlyOpen = targetBody.classList.contains('open');

    allBodies.forEach(body => body.classList.remove('open'));
    allHeaders.forEach(header => header.classList.remove('active'));
    allIcons.forEach(icon => icon.innerText = '▼');

    if (!isCurrentlyOpen) {
        targetBody.classList.add('open');
        targetHeader.classList.add('active');
        targetIcon.innerText = '▲';
        targetHeader.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}
// ==========================================
// 📚 공통 지문 보관함 엔진 (국어/영어 장문 및 세트 문항 완벽 대응)
// ==========================================
var commonPassages = []; // 압축된 지문 이미지(Base64)들을 누적해서 담아둘 배열

function toggleCommonPassageTray() {
    const tray = document.getElementById('common-passage-tray');
    const icon = document.getElementById('tray-icon');
    if (tray.style.display === 'none') {
        tray.style.display = 'block';
        icon.innerText = '📂';
    } else {
        tray.style.display = 'none';
        icon.innerText = '📚';
    }
}

// 💡 [추가] 지문 보관함 저장 및 서랍 닫기
function saveAndClosePassageTray() {
    const tray = document.getElementById('common-passage-tray');
    if (tray) {
        tray.style.display = 'none'; // 서랍 닫기
    }
    // 알림창이 번거로우시면 아래 alert는 지우셔도 됩니다.
    alert("✅ 지문이 안전하게 보관되었습니다. 이제 아래에서 문항을 계속 분석하세요!");
}

// 💡 [추가] 지문 보관함 전체 초기화
function clearAllPassages() {
    // ⚠️ 선생님 코드에 있는 실제 지문 배열 변수명이 commonPassages가 맞는지 확인해 주세요.
    if (typeof commonPassages === 'undefined' || commonPassages.length === 0) {
        alert("보관된 지문이 없습니다.");
        return;
    }
    
    if (confirm("보관된 모든 공통 지문을 삭제하시겠습니까?")) {
        commonPassages = []; // 배열 싹 비우기
        
        // ⚠️ 지문 이미지가 담기는 HTML 컨테이너 ID를 선생님 코드에 맞게 수정해 주세요. (예: passage-list, common-passage-preview 등)
        const container = document.getElementById('common-passage-list'); 
        if (container) {
            container.innerHTML = '';
        }
        alert("지문이 모두 초기화되었습니다.");
    }
}
// 📁 파일 탐색기로 올리기
function handlePassageFiles(event) {
    const files = event.target.files;
    for (let i = 0; i < files.length; i++) {
        processPassageFile(files[i]);
    }
}

// 📋 버튼 눌러서 클립보드 이미지 바로 붙여넣기
async function pastePassageFromClipboard() {
    try {
        const clipboardItems = await navigator.clipboard.read();
        let foundImage = false;
        for (const clipboardItem of clipboardItems) {
            for (const type of clipboardItem.types) {
                if (type.startsWith('image/')) {
                    const blob = await clipboardItem.getType(type);
                    processPassageFile(blob);
                    foundImage = true;
                }
            }
        }
        if (!foundImage) alert("클립보드에 복사된 그림이 없습니다.\n먼저 [윈도우키 + Shift + S] 로 지문을 캡처해 주세요.");
    } catch (err) {
        alert("클립보드 접근 권한이 차단되어 있습니다. 브라우저 주소창 왼쪽 자물쇠 아이콘에서 권한을 허용해 주세요.");
    }
}

// 이미지를 받아서 선생님의 압축엔진(compressCaptureImage)으로 용량을 줄인 뒤 서랍에 넣기
function processPassageFile(blob) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const base64Str = e.target.result;
        // 기존 시스템에 있는 압축 함수 활용
        compressCaptureImage(base64Str, (compressed) => {
            commonPassages.push(compressed);
            renderPassageThumbnails();
        });
    };
    reader.readAsDataURL(blob);
}

// 보관함에 썸네일 예쁘게 그려주기
function renderPassageThumbnails() {
    const container = document.getElementById('passage-thumbnails');
    container.innerHTML = '';
    commonPassages.forEach((base64, idx) => {
        const wrap = document.createElement('div');
        wrap.style.cssText = "position: relative; width: 80px; height: 80px; border-radius: 6px; overflow: hidden; border: 1px solid #cbd5e1; box-shadow: 0 2px 4px rgba(0,0,0,0.1);";
        wrap.innerHTML = `
            <img src="${base64}" style="width: 100%; height: 100%; object-fit: cover;">
            <button onclick="removePassage(${idx})" style="position: absolute; top: 2px; right: 2px; background: rgba(239,68,68,0.9); color: white; border: none; border-radius: 50%; width: 20px; height: 20px; font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center;">&times;</button>
        `;
        container.appendChild(wrap);
    });
}

function removePassage(index) {
    commonPassages.splice(index, 1);
    renderPassageThumbnails();
}

// ==========================================
// 💬 협업 업무 메모 (쪽지) 시스템
// ==========================================
let unsubscribeMemos = null;

function openMemoBoard() {
    document.getElementById('memo-modal').style.display = 'flex';
    
    if (unsubscribeMemos) unsubscribeMemos();
    
    // 💡 실시간 감시 (카톡처럼 다른 사람이 쓰면 바로 뜸)
    unsubscribeMemos = db.collection('user_projects').doc(currentProjectId).onSnapshot(doc => {
        if (doc.exists) {
            const data = doc.data();
            const memos = data.memos || [];
            renderMemos(memos);
            markMemosAsRead(memos); // 모달을 여는 순간, 안 읽은 메모들을 '읽음' 처리
        }
    });
}

function closeMemoBoard() {
    document.getElementById('memo-modal').style.display = 'none';
    if (unsubscribeMemos) {
        unsubscribeMemos();
        unsubscribeMemos = null;
    }
    loadProjectDetails(); // 창을 닫을 때 메인 화면의 '안 읽은 개수 뱃지'를 갱신
}

function renderMemos(memos) {
    const listEl = document.getElementById('memo-list');
    const currentUserEmail = auth.currentUser.email;

    if (memos.length === 0) {
        listEl.innerHTML = '<div style="text-align:center; color:#94a3b8; margin-top: 40%;">아직 등록된 메모가 없습니다.<br>동료 선생님께 첫 메모를 남겨보세요!</div>';
        return;
    }

    let html = '';
    memos.forEach(memo => {
        const isMe = memo.authorEmail === currentUserEmail;
        const align = isMe ? 'flex-end' : 'flex-start';
        const bgColor = isMe ? '#fef3c7' : '#f1f5f9';
        const borderColor = isMe ? '#fde68a' : '#e2e8f0';
        const nameStr = isMe ? '나' : memo.authorName;

        // 💡 핵심 로직: 내가 쓴 글이 아닐 때만 카운트 (작성자는 읽음 수에서 제외)
        const readCount = (memo.readBy || []).filter(e => e !== memo.authorEmail).length;
        const readBadge = readCount > 0 ? `<span style="font-size:0.75rem; color:#f59e0b; font-weight:bold; margin: 0 4px;">읽음 ${readCount}</span>` : '';

        const dateObj = memo.timestamp ? new Date(memo.timestamp) : null;
        const dateTimeStr = dateObj ? 
            `${dateObj.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })} ${dateObj.toLocaleTimeString('ko-KR', { hour: '2-digit', minute:'2-digit' })}` 
            : '';

        html += `
        <div style="display: flex; flex-direction: column; align-items: ${align}; margin-bottom: 15px;">
            <span style="font-size: 0.8rem; color: #64748b; margin-bottom: 4px; font-weight: bold;">${nameStr}</span>
            <div style="display: flex; align-items: flex-end; flex-direction: ${isMe ? 'row-reverse' : 'row'};">
                <div style="background: ${bgColor}; border: 1px solid ${borderColor}; padding: 10px 14px; border-radius: 12px; max-width: 250px; font-size: 0.95rem; word-break: break-all; white-space: pre-wrap; color: #1e293b; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">${memo.text}</div>
                <div style="display: flex; flex-direction: column; align-items: ${isMe ? 'flex-end' : 'flex-start'}; margin: 0 6px;">
                    ${readBadge}
                    <span style="font-size: 0.7rem; color: #94a3b8;">${dateTimeStr}</span>
                </div>
            </div>
        </div>`;
    });
    listEl.innerHTML = html;
    listEl.scrollTop = listEl.scrollHeight; // 새로운 글이 오면 맨 아래로 자동 스크롤
}

async function submitMemo() {
    const inputEl = document.getElementById('memo-input');
    const text = inputEl.value.trim();
    if (!text) return;

    const user = auth.currentUser;
    const newMemo = {
        id: 'memo_' + Date.now() + Math.random().toString(36).substr(2, 5),
        text: text,
        authorEmail: user.email,
        authorName: user.email.split('@')[0], // 아이디 앞부분만 이름으로 사용
        timestamp: new Date().toISOString(),
        readBy: [] // 처음엔 아무도 안 읽은 상태 (빈 배열)
    };

    inputEl.value = ''; // 전송 후 입력창 즉시 비우기

    try {
        await db.collection('user_projects').doc(currentProjectId).update({
            memos: firebase.firestore.FieldValue.arrayUnion(newMemo)
        });
    } catch(e) {
        alert("메모 전송 실패: " + e.message);
    }
}

async function markMemosAsRead() {
    // 💡 방어막 추가: 로그인이 안 되어 있거나 폴더 ID가 없으면 중단
    if (!auth.currentUser || !currentProjectId) return;

    const userEmail = auth.currentUser.email;
    const docRef = db.collection('user_projects').doc(currentProjectId);

    try {
        // 🔒 마법의 자물쇠(트랜잭션) 시작
        await db.runTransaction(async (transaction) => {
            // 1. 트랜잭션 안에서 DB의 '가장 최신' 상태를 실시간으로 다시 읽어옵니다.
            const doc = await transaction.get(docRef);
            if (!doc.exists) return; 

            const data = doc.data();
            const latestMemos = data.memos || [];
            let needsUpdate = false;

            // 2. 방금 가져온 최신 메모 목록을 기준으로 '읽음' 처리를 계산합니다.
            const updatedMemos = latestMemos.map(memo => {
                // 내가 쓴 글이 아니고, 아직 내 이메일이 '읽음' 목록에 없다면 추가!
                if (memo.authorEmail !== userEmail && !(memo.readBy || []).includes(userEmail)) {
                    needsUpdate = true;
                    return { ...memo, readBy: [...(memo.readBy || []), userEmail] };
                }
                return memo;
            });

            // 3. 갱신할 게 확인되면, 다른 사람의 글을 덮어씌우지 않고 내 '읽음' 기록만 안전하게 추가(update)합니다.
            if (needsUpdate) {
                transaction.update(docRef, { memos: updatedMemos });
            }
        });
        
    } catch (e) {
        console.error("읽음 처리 트랜잭션 실패:", e);
    }
}


async function updateQuestionCount() {
    currentSubjectQCount = {}; // 초기화
    
    // 💡 [핵심 수정] 관리자 설정창 뿐만 아니라, 일반 탭 화면의 과목도 정확히 인식하도록 수정
    const targetSubject = currentSubject || "uncategorized";

    if (targetSubject && targetSubject !== 'uncategorized') {
        try {
            const snapshot = await db.collection('transformed_bank')
                                     .where('subject', '==', targetSubject)
                                     .get();
                                     
            snapshot.forEach(doc => {
                const stdCode = doc.data().standard_code;
                if (stdCode && stdCode !== "unknown" && stdCode !== "코드없음") {
                    const cleanCode = stdCode.replace(/[\[\]\s]/g, ''); // 대괄호 제거
                    currentSubjectQCount[cleanCode] = (currentSubjectQCount[cleanCode] || 0) + 1;
                }
            });
            
            // 🌟 [추가됨] 문항이 새로 추가되었으므로, 수첩(캐시)의 내용도 '최신 개수'로 덮어씁니다!
            cachedSubjectQCounts[targetSubject] = currentSubjectQCount;
            
            console.log("✅ 문항 수 갱신 완료:", currentSubjectQCount);
            
            // 💡 대시보드 새로고침: 문항이 추가되면 회색 버튼이 파란색으로 즉시 바뀌도록 호출!
            if (document.getElementById('card-container')) {
                initDashboard(); 
            }
            
        } catch(e) { 
            console.warn("문항 수 계산 실패", e); 
        }
    }
}

// [수정] 라디오 버튼 상태에 따라 부분 추출/핀셋 추출 창을 제어합니다.
function toggleExamRangeInputs() {
    const extractMode = document.querySelector('input[name="extractMode"]:checked')?.value || 'all';
    const partialOptionsDiv = document.getElementById('partial-extract-options');
    const tweezerOptionsDiv = document.getElementById('tweezer-extract-options'); // 추가됨
    
    if (partialOptionsDiv) partialOptionsDiv.style.display = (extractMode === 'partial') ? 'flex' : 'none';
    if (tweezerOptionsDiv) tweezerOptionsDiv.style.display = (extractMode === 'tweezer') ? 'block' : 'none';
}

// 2. 임시로 이미지를 보관해둘 변수
let tempExamBase64 = null;

// 1️⃣ [완벽 교체] 업로드 도중 폴더를 이동해도 꼬이지 않게 자물쇠를 채운 업로드 함수
function previewExamFile(event) {
    const file = event.target.files[0];
    const startBtn = document.getElementById('start-analysis-btn');
    
    if (!file) {
        if (startBtn) startBtn.style.display = 'none';
        return;
    }
    
    if (window.localExamUrl) {
        URL.revokeObjectURL(window.localExamUrl);
    }
    window.localExamUrl = URL.createObjectURL(file);
    
    const reader = new FileReader();
    reader.onload = function(e) {
        tempExamBase64 = e.target.result;
        examImages = [tempExamBase64]; 
        
        // 💡 파일이 준비되면 분석 시작 버튼을 확실하게 띄움
        if (startBtn) startBtn.style.display = 'inline-block';
    };
    reader.readAsDataURL(file);

    // 💡 [핵심 해결] 업로드 버튼을 누른 순간의 폴더 방 번호를 자물쇠로 꽉 잠가둡니다!
    const uploadProjectId = currentProjectId;
    const uploadAsmIndex = currentEditingAssessmentIndex;

    try {
        const fileRef = storage.ref().child(`exam_images/${Date.now()}_${file.name}`);
        fileRef.put(file).then(snapshot => {
            snapshot.ref.getDownloadURL().then(async url => {
                // 업로드 도중에 선생님이 다른 폴더로 나갔다면, 현재 화면에는 덮어쓰지 않음
                if (currentProjectId === uploadProjectId && currentEditingAssessmentIndex === uploadAsmIndex) {
                    currentUploadedImageUrl = url;
                }

                // 💡 [귀신 현상 차단] 무조건 "업로드 버튼을 눌렀던 최초의 폴더" DB에만 정확히 저장합니다.
                if (uploadProjectId && uploadAsmIndex !== -1) {
                    const docRef = db.collection('user_projects').doc(uploadProjectId);
                    try {
                        await db.runTransaction(async (transaction) => {
                            const doc = await transaction.get(docRef);
                            if(doc.exists) {
                                let assessments = doc.data().assessments;
                                if(assessments[uploadAsmIndex]) {
                                    assessments[uploadAsmIndex].imageUrl = url;
                                    transaction.update(docRef, { assessments: assessments });
                                }
                            }
                        });
                    } catch (e) {}
                }
            });
        }).catch(err => {});
    } catch(error) {}
}


// 4. "분석 시작하기" 버튼을 눌렀을 때 실행되는 함수
function executeExamAnalysis() {
    if (!tempExamBase64) {
        alert("시험지 파일이 준비되지 않았습니다. 다시 선택해주세요.");
        return;
    }

    // 💡 [수정1] AI 분석을 서버에 요청하기 '전'에 안내창을 띄우도록 변경!
    if (typeof extractedQuestionsArray !== 'undefined' && extractedQuestionsArray.length > 0) {
        const isAppend = confirm("기존에 추출된 문항이 있습니다. 설정하신 범위의 문항을 추가로 추출하여 아래에 덧붙이시겠습니까?\n\n[확인]: 기존 목록 뒤에 이어서 추가\n[취소]: 기존 내용 싹 지우고 새로 시작");
        if (!isAppend) {
            extractedQuestionsArray = []; 
        }
    } else {
        extractedQuestionsArray = [];
    }

    document.getElementById('start-analysis-btn').style.display = 'none';
    startExamAiAnalysis(tempExamBase64);
}


async function startExamAiAnalysis(base64Data) {
    if (!requireApiKey()) {
        document.getElementById('exam-loading').style.display = 'none'; 
        document.getElementById('start-analysis-btn').style.display = 'inline-block';
        return; 
    }
    const loadingEl = document.getElementById('exam-loading');
    if (loadingEl) loadingEl.style.display = 'block';

    const extractMode = document.querySelector('input[name="extractMode"]:checked')?.value || 'all';
    const isExtractAll = (extractMode === 'all');
    
   // 💡 [추가] 핀셋 모드 변수 수집
    const isTweezerMode = (extractMode === 'tweezer');
    const tweezerNums = document.getElementById('exam-tweezer-nums')?.value || "";
    
    const isChoiceChecked = document.getElementById('exam-check-choice')?.checked || false;
    const isShortChecked = document.getElementById('exam-check-short')?.checked || false;
       
    const startNum = document.getElementById('exam-start-num')?.value || "1";
    const endNum = document.getElementById('exam-end-num')?.value || "10";
    const shortStartNum = document.getElementById('exam-short-start')?.value || "1";
    const shortEndNum = document.getElementById('exam-short-end')?.value || "5";

    try {
        const mimeTypeMatch = base64Data.match(/data:(.*?);base64/);
        const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : "image/jpeg";
        const base64Clean = base64Data.split(',')[1];
        const referenceDBText = await fetchReferenceQuestions(currentSubject);

        const workerUrl = "https://script.google.com/macros/s/AKfycbwgx4RgF8FQxxL3jBgEQ5l369llADjhZ1NepulIdF4DdX18kBrB8oRQ4Ft0d5WdKtEF/exec";
        const userApiKey = localStorage.getItem('gemini_api_key');
        
        const response = await fetch(workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: "exam_analysis",
                mimeType: mimeType,
                base64Clean: base64Clean,
                referenceDBText: referenceDBText,
                subject: currentSubject,
                isExtractAll: isExtractAll,
                isTweezerMode: isTweezerMode, 
                tweezerNums: tweezerNums,    
                isChoiceChecked: isChoiceChecked,
                isShortChecked: isShortChecked,
                startNum: startNum,
                endNum: endNum,
                shortStartNum: shortStartNum,
                shortEndNum: shortEndNum,
                apiKey: userApiKey
            })
        });

        await checkApiError(response);
        const data = await response.json();
        
        if (data.error) {
            let errMsg = data.error.message || "";
            let koreanError = "구글 AI 처리 중 알 수 없는 오류가 발생했습니다.";
            
            if (errMsg.includes("API key not valid")) koreanError = "입력하신 API 키가 유효하지 않습니다. 키를 다시 확인해주세요.";
            else if (errMsg.includes("models/") || errMsg.includes("not found")) koreanError = "AI 모델 버전을 찾을 수 없습니다. 백엔드의 모델명을 확인해주세요.";
            else if (errMsg.includes("quota") || errMsg.includes("RESOURCE_EXHAUSTED")) koreanError = "무료 사용량(할당량) 한도를 초과했습니다! API 키를 갱신해주세요.";
            else if (errMsg.includes("high demand") || errMsg.includes("overloaded")) koreanError = "현재 구글 서버에 접속자가 많아 지연되고 있습니다. 잠시 후 다시 시도해주세요.";
            else koreanError = "AI 시험지 추출 오류: " + errMsg;
            
            throw new Error(koreanError);
        }
        
        const fullText = data.candidates[0].content.parts[0].text;
        const blocks = fullText.split('---').map(b => b.trim()).filter(b => b.length > 0);
        
        // 💡 [필수 수정] await 데이터 저장을 위해 forEach를 for...of 반복문으로 변경했습니다. (유실 없음)
        for (const block of blocks) {
            let numMatch = block.match(/\[번호\]\s*([^|]+)/) 
                        || block.match(/\[([가-힣a-zA-Z\s]*\d+[가-힣a-zA-Z\s]*)\]/) 
                        || block.match(/(?:문항)?\s*([가-힣a-zA-Z\s]*\d+)\s*번?/);
            let scoreMatch = block.match(/\[배점\][^0-9]*([\d.]+)/);
            
            let levelMatch = block.match(/\[수준\]\s*(A\+|[A-E])/);
            let reasonMatch = block.match(/\[이유\]\s*([^|]+)/);
            let contentMatch = block.match(/\[문항내용\]\s*([\s\S]*)/);

            let qNumRaw = numMatch ? numMatch[1].replace(/\*/g, '').trim() : "수동입력(확인요망)";
            let qNum = qNumRaw;
            if (qNumRaw.includes('서답') || qNumRaw.includes('서술') || qNumRaw.includes('서')) {
                let numPart = qNumRaw.replace(/[^0-9]/g, '');
                qNum = numPart ? "서" + numPart : qNumRaw;
            } else {
                let numPart = qNumRaw.replace(/[^0-9]/g, '');
                qNum = numPart ? numPart : qNumRaw; 
            }

            let score = scoreMatch ? scoreMatch[1] : "0";
            let level = levelMatch ? levelMatch[1].trim() : "C";
            let reason = reasonMatch ? reasonMatch[1].trim() : "AI 판정 이유가 분석되지 않았습니다.";
            
            let pureText = contentMatch ? contentMatch[1].trim() : block;
            
            let pRange = "";
            let pText = "";
            let cleanText = pureText;
            
            const pMatch = pureText.match(/\[공통지문:\s*(.+?)\]([\s\S]*?)\[지문끝\]/);
            if(pMatch) {
                pRange = pMatch[1].trim();
                pText = pMatch[2].trim();
                cleanText = pureText.replace(pMatch[0], '').trim();
            }
            
            extractedQuestionsArray.push({ 
                num: qNum, 
                text: cleanText,  // 텍스트 창에는 순수 문제만!
                score: score, 
                level: level,     // 수준은 뒷주머니에 보관!
                reason: reason,   // 판정이유도 뒷주머니에 보관!
                image: null,
                passageRange: pRange,   
                passageContent: pText   
            });

            // 🌟 [여기만 추가됨] 추출된 문항을 지문 데이터와 함께 서랍에 자동 분리 저장
            let innerCodeMatch = reason.match(/([1-9][0-9][가-힣a-zA-Z0-9-]+-\d+-\d+)/g) || ["미분류"];
            let codesJoinStr = innerCodeMatch.join(', ');
            await saveAnalysisAutomatically(cleanText, codesJoinStr, level, reason, base64Data, typeof commonPassages !== 'undefined' ? commonPassages : [], pText);
        }

        extractedQuestionsArray.sort((a, b) => {
            const aIsShort = String(a.num).startsWith('서');
            const bIsShort = String(b.num).startsWith('서');
            if (aIsShort && !bIsShort) return 1;  
            if (!aIsShort && bIsShort) return -1; 
            
            const aNum = parseInt(a.num.replace(/[^0-9]/g, '')) || 0;
            const bNum = parseInt(b.num.replace(/[^0-9]/g, '')) || 0;
            return aNum - bNum;
        });

        const helperZone = document.getElementById('ai-helper-zone');
        if (helperZone) helperZone.style.display = 'none';
        
        const inspectorWrapper = document.getElementById('exam-inspector-wrapper');
        if (inspectorWrapper) inspectorWrapper.style.display = 'flex';
        
        renderQuestionCards(); 

        if (extractedQuestionsArray.length === 0) {
            const listContainer = document.getElementById('extracted-questions-list');
            if (listContainer) {
                listContainer.innerHTML = `
                <div style="text-align:center; background:#fee2e2; padding:2rem; border-radius:8px; margin-top:20px; border: 1px solid #f87171;">
                    <p style="color:#dc2626; font-size:1.1rem; font-weight:bold; margin-bottom:15px;">⚠️ AI가 조건에 맞는 문항을 추출하지 못했습니다.</p>
                    <p style="color:#7f1d1d; margin-bottom:20px;">지문 범위를 좁히거나, 다른 조건을 선택하여 다시 시도해 보세요.</p>
                    <button onclick="executeExamAnalysis()" style="background:#ef4444; color:white; border:none; padding:10px 20px; border-radius:6px; cursor:pointer; font-weight:bold; font-size:1rem; box-shadow:0 2px 4px rgba(0,0,0,0.1); transition:0.2s;">🔄 다른 조건으로 다시 분석하기</button>
                </div>`;
            }
        }

    } catch (error) {
        alert("분석 중 오류가 발생했습니다.\n" + error.message);
    } finally {
        if (loadingEl) loadingEl.style.display = 'none';
        
        const btn = document.getElementById('start-analysis-btn');
        if (btn) btn.style.display = 'inline-block';
        
        const imgEl = document.getElementById('exam-img-display');
        const pdfEl = document.getElementById('exam-pdf-display'); 
        
        if (examImages.length > 0) {
            const fileData = examImages[0];
            if (fileData.includes("application/pdf")) {
                if(imgEl) imgEl.style.display = 'none';
                if(pdfEl) { pdfEl.src = window.localExamUrl || fileData; pdfEl.style.display = 'block'; }
            } else {
                if(pdfEl) pdfEl.style.display = 'none';
                if(imgEl) { imgEl.src = window.localExamUrl || fileData; imgEl.style.display = 'block'; }
            }
        }
    }
}

// ✨ AI가 찾아낸 성취기준 코드로 과목 ID를 자동 판별하는 마법의 함수 (완벽 수정본)
function detectSubjectIdFromStandardCode(code) {
    if (!code) return 'uncategorized';
    
    // 🧪 과학
    if (code.includes('통과1') || code.includes('통과 1')) return 'sci_common1';
    if (code.includes('통과2') || code.includes('통과 2')) return 'sci_common2';
    if (code.includes('물리')) return 'sci_phy';
    if (code.includes('화학')) return 'sci_chem';
    if (code.includes('생명') || code.includes('생과')) return 'sci_bio';
    if (code.includes('지구') || code.includes('지과')) return 'sci_earth';
    
    // 📐 수학 (공수1, 공수2 추가)
    if (code.includes('공수1') || code.includes('공수 1') || (code.includes('10수학') && code.includes('-01-'))) return 'common1'; 
    if (code.includes('공수2') || code.includes('공수 2') || (code.includes('10수학') && code.includes('-02-'))) return 'common2'; 
    if (code.includes('대수')) return 'algebra';
    if (code.includes('미적Ⅱ') || code.includes('미적분Ⅱ')) return 'calculus2';
    if (code.includes('미적Ⅰ') || code.includes('미적분Ⅰ') || code.includes('미적')) return 'calculus1';
    if (code.includes('확통') || code.includes('확률')) return 'probStat';
    if (code.includes('기하')) return 'geometry';
    if (code.includes('경수') || code.includes('경제수학')) return 'econ_math';
    if (code.includes('인수') || code.includes('인공지능')) return 'ai-math';

    // 📖 국어 (화언, 문학 약어 추가)
    if (code.includes('독작') || code.includes('독서') || code.includes('작문')) return 'kor_read_write';
    if (code.includes('공국1') || (code.includes('10국어') && code.includes('-01-'))) return 'kor_common1';
    if (code.includes('공국2') || (code.includes('10국어') && code.includes('-02-'))) return 'kor_common2';
    if (code.includes('화언') || code.includes('화법')) return 'kor_speech';
    if (code.includes('문학')) return 'kor_lit';
    
    // 🗣️ 영어 (공영2 오타 수정 및 영Ⅰ, 영Ⅱ 추가)
    if (code.includes('공영1') || (code.includes('10영어') && code.includes('-01-'))) return 'eng_common1';
    if (code.includes('공영2') || (code.includes('10영어') && code.includes('-02-'))) return 'eng_common2';
    if (code.includes('영Ⅰ') || code.includes('영어Ⅰ') || code.includes('영어1')) return 'eng_1';
    if (code.includes('영Ⅱ') || code.includes('영어Ⅱ') || code.includes('영어2')) return 'eng_2';
    
    // 🌍 사회 (한사1, 한사2 약어 추가)
    if (code.includes('통사1') || code.includes('통사 1')) return 'soc_common1';
    if (code.includes('통사2') || code.includes('통사 2')) return 'soc_common2';
    if (code.includes('한사1') || code.includes('한국사1') || code.includes('한국사 1')) return 'history1';
    if (code.includes('한사2') || code.includes('한국사2') || code.includes('한국사 2')) return 'history2';

    return 'uncategorized';
}


// 💡 그리고 기존 저장 코드에서 subject에 값을 넣을 때 위 함수를 사용합니다.
// 예시: 
// const dbData = {
//     ...
//     standard_code: q.standardCode,
//     subject: detectSubjectIdFromStandardCode(q.standardCode), // 🔥 화면 선택 무시하고 AI가 찾은 코드로 강제 지정!
//     ...
// };

function prevLevelQuestion() {
    if (currentQuestions.length === 0) return;
    currentLevelQ = (currentLevelQ - 1 + currentQuestions.length) % currentQuestions.length;
    loadLevelQuestion();
}

function skipLevelQuestion() {
    if (currentQuestions.length === 0) return;
    currentLevelQ = (currentLevelQ + 1) % currentQuestions.length;
    loadLevelQuestion();
}
// ✅ 관리자 도구의 드롭다운을 메인 화면처럼 예쁜 버튼 그룹으로 자동 변환해 주는 함수
function initAdminDropdowns() {
    const adminSelectIds = [
        'admin-subject', 
        'admin-edit-subject', 
        'admin-q-subject', 
        'admin-manage-q-subject'
    ];
    
    const groupNames = { 'math': '수학', 'korean': '국어', 'english': '영어', 'social': '사회', 'science': '과학' };
    
    adminSelectIds.forEach(id => {
        const selectEl = document.getElementById(id);
        if (!selectEl) return;
        
        // 이미 생성된 버튼이 있다면 중복 생성 방지
        if (selectEl.previousElementSibling && selectEl.previousElementSibling.className === 'admin-group-btns') return;
        
        // 버튼을 담을 상자 생성
        const btnGroup = document.createElement('div');
        btnGroup.className = 'admin-group-btns';
        btnGroup.style.cssText = 'display: flex; gap: 5px; margin-bottom: 10px; flex-wrap: wrap;';
        
        const groups = ['math', 'korean', 'english', 'social', 'science'];
        
        groups.forEach(groupId => {
            const btn = document.createElement('button');
            btn.innerText = groupNames[groupId];
            btn.style.cssText = 'flex: 1; padding: 6px; border: 1px solid #cbd5e1; background: white; border-radius: 4px; cursor: pointer; font-size: 0.85rem; transition: 0.2s;';
            
            btn.onclick = (e) => {
                e.preventDefault();
                // 클릭 시 다른 버튼들 색상 초기화
                Array.from(btnGroup.children).forEach(b => { 
                    b.style.background = 'white'; 
                    b.style.color = '#334155'; 
                    b.style.fontWeight = 'normal'; 
                    b.style.borderColor = '#cbd5e1';
                });
                // 현재 눌린 버튼 강조
                btn.style.background = '#e0e7ff'; 
                btn.style.color = '#1e40af'; 
                btn.style.fontWeight = 'bold';
                btn.style.borderColor = '#3b82f6';
                
                // 하위 성취기준 드롭다운 업데이트
                let html = '<option value="">-- 세부 과목을 선택하세요 --</option>';
                if (curriculumMap[groupId]) {
                    for (const category in curriculumMap[groupId]) {
                        html += `<optgroup label="📂 ${category}">`;
                        curriculumMap[groupId][category].forEach(sub => {
                            html += `<option value="${sub.id}">${sub.name}</option>`;
                        });
                        html += `</optgroup>`;
                    }
                }
                selectEl.innerHTML = html;
                
                // 💡 드롭다운 값이 바뀌었음을 강제로 알려서 하위 목록도 갱신하게 만듦
                selectEl.dispatchEvent(new Event('change')); 
            };
            btnGroup.appendChild(btn);
        });
        
        // 기존 셀렉트박스 바로 위에 예쁜 버튼 그룹 삽입!
        selectEl.parentNode.insertBefore(btnGroup, selectEl);
        selectEl.innerHTML = '<option value="">-- 위 교과군 버튼을 먼저 선택하세요 --</option>';
    });
}

async function loadStandardsForManage() {
    const subject = document.getElementById('admin-manage-q-subject').value;
    const stdSelect = document.getElementById('admin-manage-q-standard');
    
    stdSelect.innerHTML = '<option value="">데이터를 불러오는 중입니다...</option>';

    if (!subject) {
        stdSelect.innerHTML = '<option value="">과목을 선택하세요</option>';
        return;
    }

    try {
        const snapshot = await db.collection('standards_2022').where('subject', '==', subject).get();
        let stds = [];
        snapshot.forEach(doc => stds.push({ id: doc.id, code: doc.data().code, desc: doc.data().desc }));
        
        stds.sort((a,b) => a.code.localeCompare(b.code));

        stdSelect.innerHTML = '<option value="">-- 수정할 성취기준 선택 --</option>';
        stds.forEach(std => {
            stdSelect.innerHTML += `<option value="${std.id}">${std.code} ${std.desc.substring(0, 25)}...</option>`;
        });
    } catch (error) {
        console.error("목록 불러오기 실패:", error);
        stdSelect.innerHTML = '<option value="">불러오기 오류 발생</option>';
    }
}

// 🟢 [추가] 다운로드 딜레이 중 화면을 예쁘게 가려줄 로딩 UI (JS로 자동 생성)
function showSystemLoading() {
    let loader = document.getElementById('system-update-loader');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'system-update-loader';
        loader.innerHTML = `
            <div style="position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(255,255,255,0.95); z-index:99999; display:flex; flex-direction:column; justify-content:center; align-items:center;">
                <div style="width:60px; height:60px; border:6px solid #e2e8f0; border-top-color:#1e3a8a; border-radius:50%; animation:spin 1s linear infinite; margin-bottom:20px;"></div>
                <h2 style="color:#1e3a8a; margin-bottom:10px;">데이터베이스 최신화 중... ⏳</h2>
                <p style="color:#64748b; font-weight:bold; margin-bottom:5px;">새로운 시스템 데이터(성취기준 등)를 불러오고 있습니다.</p>
                <p style="color:#94a3b8; font-size:0.9rem;">잠시만 기다려주세요 (최초 1회만 약 3~5초 소요됩니다)</p>
                <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
            </div>
        `;
        document.body.appendChild(loader);
    }
    loader.style.display = 'flex';
}

function hideSystemLoading() {
    const loader = document.getElementById('system-update-loader');
    if (loader) loader.style.display = 'none';
}

// =========================================================================
// 🚨 [필독] 이 코드를 main.js 파일의 **가장 맨 아래 (마지막 줄)**에 붙여넣으세요! 🚨
// 기존 코드를 찾아서 지울 필요 없습니다. 맨 밑에 추가만 하시면 무조건 이 코드가 우선 실행됩니다.
// =========================================================================

// 1️⃣ 시험지 지우기 + 버튼 및 추출 옵션 초기화 완벽 제어
window.clearExamFile = async function() {
    if(!confirm("업로드된 시험지와 추출된 문항을 모두 초기화하시겠습니까?")) return;

    // 파일 첨부칸 이름표(exam-file) 정확히 비우기
    const fileInput = document.getElementById('exam-file');
    if (fileInput) fileInput.value = '';
    
    const imgEl = document.getElementById('exam-img-display');
    const pdfEl = document.getElementById('exam-pdf-display');
    if (imgEl) { imgEl.src = ''; imgEl.style.display = 'none'; }
    if (pdfEl) { pdfEl.src = ''; pdfEl.style.display = 'none'; }
    
    const wrapper = document.getElementById('exam-inspector-wrapper');
    if (wrapper) wrapper.style.display = 'none';

    // 💡 [추가된 부분] 추출 옵션(전체/범위/핀셋) 라디오 버튼 및 입력창 완전 초기화
    const extractAllRadio = document.querySelector('input[name="extractMode"][value="all"]');
    if (extractAllRadio) extractAllRadio.checked = true; 
    
    const rangeInputs = ['exam-start-num', 'exam-end-num', 'exam-short-start', 'exam-short-end', 'exam-tweezer-nums'];
    rangeInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    
    if (document.getElementById('exam-check-choice')) document.getElementById('exam-check-choice').checked = false;
    if (document.getElementById('exam-check-short')) document.getElementById('exam-check-short').checked = false;

    if (typeof toggleExamRangeInputs === 'function') toggleExamRangeInputs();
    // 💡 [추가된 부분 끝]

    extractedQuestionsArray = [];
    const listContainer = document.getElementById('extracted-questions-list');
    if (listContainer) listContainer.innerHTML = '<p style="text-align:center; color:#94a3b8; margin-top:20px;">시험지를 초기화했습니다. 다시 업로드해주세요.</p>';
    
    tempExamBase64 = null;
    examImages = [];

    currentUploadedImageUrl = null; 
    if (window.localExamUrl) {
        URL.revokeObjectURL(window.localExamUrl);
        window.localExamUrl = null;
    }
    
    // 파일이 지워졌으니 분석 버튼 숨기기 (새로 올리면 다시 나타남)
    const startBtn = document.getElementById('start-analysis-btn');
    if (startBtn) startBtn.style.display = 'none';

    // DB 데이터 완전 삭제
    if (typeof currentProjectId !== 'undefined' && currentEditingAssessmentIndex !== -1 && currentProjectId) {
        try {
            const docRef = db.collection('user_projects').doc(currentProjectId);
            await db.runTransaction(async (transaction) => {
                const doc = await transaction.get(docRef);
                if(doc.exists) {
                    let assessments = doc.data().assessments;
                    if(assessments[currentEditingAssessmentIndex]) {
                        assessments[currentEditingAssessmentIndex].imageUrl = null; 
                        transaction.update(docRef, { assessments: assessments });
                    }
                }
            });
        } catch(e) { console.error("DB 이미지 초기화 실패:", e); }
    }
    
    alert('업로드된 시험지가 완벽하게 삭제되었습니다.');
};

// 2️⃣ 파일 업로드 꼬임 방지 및 분석 버튼 복구
window.previewExamFile = function(event) {
    const file = event.target.files[0];
    const startBtn = document.getElementById('start-analysis-btn');
    
    if (!file) {
        if (startBtn) startBtn.style.display = 'none';
        return;
    }
    
    if (window.localExamUrl) {
        URL.revokeObjectURL(window.localExamUrl);
    }
    window.localExamUrl = URL.createObjectURL(file);
    
    const reader = new FileReader();
    reader.onload = function(e) {
        tempExamBase64 = e.target.result;
        examImages = [tempExamBase64]; 
        if (startBtn) startBtn.style.display = 'inline-block'; // 정상 업로드 시 분석 버튼 뿅!
    };
    reader.readAsDataURL(file);

    const uploadProjectId = currentProjectId;
    const uploadAsmIndex = currentEditingAssessmentIndex;

    try {
        const fileRef = storage.ref().child(`exam_images/${Date.now()}_${file.name}`);
        fileRef.put(file).then(snapshot => {
            snapshot.ref.getDownloadURL().then(async url => {
                if (currentProjectId === uploadProjectId && currentEditingAssessmentIndex === uploadAsmIndex) {
                    currentUploadedImageUrl = url;
                }
                if (uploadProjectId && uploadAsmIndex !== -1) {
                    const docRef = db.collection('user_projects').doc(uploadProjectId);
                    try {
                        await db.runTransaction(async (transaction) => {
                            const doc = await transaction.get(docRef);
                            if(doc.exists) {
                                let assessments = doc.data().assessments;
                                if(assessments[uploadAsmIndex]) {
                                    assessments[uploadAsmIndex].imageUrl = url;
                                    transaction.update(docRef, { assessments: assessments });
                                }
                            }
                        });
                    } catch (e) {}
                }
            });
        }).catch(err => {});
    } catch(error) {}
};

// 3️⃣ 폴더 이동 시 모든 찌꺼기 차단, 추출 옵션 초기화 및 도우미 창 닫기
window.startEditAssessment = function(index) {
    currentEditingAssessmentIndex = index;
    history.pushState({ section: 'cut-score', sub: 'step2' }, "", "#cut-score/step2");

    // 폴더 이동 시 기존 파일 이름표 지우기
    const fileInput = document.getElementById('exam-file');
    if (fileInput) fileInput.value = ''; 
    
    // 💡 [추가된 부분] 다른 고사로 들어갈 때마다 추출 옵션을 항상 '전체 추출'로 초기화
    const extractAllRadio = document.querySelector('input[name="extractMode"][value="all"]');
    if (extractAllRadio) extractAllRadio.checked = true;
    
    const rangeInputs = ['exam-start-num', 'exam-end-num', 'exam-short-start', 'exam-short-end', 'exam-tweezer-nums'];
    rangeInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    
    if (document.getElementById('exam-check-choice')) document.getElementById('exam-check-choice').checked = false;
    if (document.getElementById('exam-check-short')) document.getElementById('exam-check-short').checked = false;

    if (typeof toggleExamRangeInputs === 'function') toggleExamRangeInputs();
    // 💡 [추가된 부분 끝]

    extractedQuestionsArray = []; 
    const listContainer = document.getElementById('extracted-questions-list');
    if (listContainer) listContainer.innerHTML = ''; 

    tempExamBase64 = null;
    examImages = [];
    currentUploadedImageUrl = null;
    if (window.localExamUrl) {
        URL.revokeObjectURL(window.localExamUrl);
        window.localExamUrl = null;
    }

    const imgEl = document.getElementById('exam-img-display');
    const pdfEl = document.getElementById('exam-pdf-display');
    if (imgEl) { imgEl.src = ''; imgEl.style.display = 'none'; }
    if (pdfEl) { pdfEl.src = ''; pdfEl.style.display = 'none'; }
    
    const wrapper = document.getElementById('exam-inspector-wrapper');
    if (wrapper) wrapper.style.display = 'none';

    // 폴더 이동했으니 새로운 파일 올리기 전까지 분석 버튼 숨김
    const startBtn = document.getElementById('start-analysis-btn');
    if (startBtn) startBtn.style.display = 'none';

    const applyBtnContainer = document.getElementById('external-apply-btn-zone');
    if (applyBtnContainer) applyBtnContainer.style.display = 'none';

    // 💡 AI 도우미 창 강제 닫기
    const helperZone = document.getElementById('ai-helper-zone');
    if (helperZone) helperZone.style.display = 'none';

    document.getElementById('project-detail-view').style.display = 'none';
    document.getElementById('cut-score-step2').style.display = 'block';
    
    if (typeof projectDetailsUnsubscribe !== 'undefined' && projectDetailsUnsubscribe) {
        projectDetailsUnsubscribe();
        projectDetailsUnsubscribe = null;
    }

    if (typeof unsubscribeProject !== 'undefined' && unsubscribeProject) unsubscribeProject();

    unsubscribeProject = db.collection('user_projects').doc(currentProjectId).onSnapshot(doc => {
        if(doc.exists) {
            const projectData = doc.data();
            const asm = projectData.assessments[index];
            if (typeof currentActiveStep !== 'undefined' && currentActiveStep !== 4) {
                document.getElementById('current-assessment-info').innerText = `📌 ${asm.name} (반영 비율: ${asm.weight}%)`;
            } else if (typeof updateMTableStatus === 'function') {
                updateMTableStatus(asm, projectData);
            }
            const parsedScores = asm.parsedScores || [];
            if (parsedScores.length > 0) {
                let cCount = 0, sCount = 0;
                parsedScores.forEach(q => {
                    if(q.isShortAnswer || String(q.num).includes('서')) sCount++;
                    else cCount++;
                });
                document.getElementById('choice-count').value = cCount;
                document.getElementById('short-count').value = sCount;
            } else {
                document.getElementById('choice-count').value = 20;
                document.getElementById('short-count').value = 5;
            }
            
            cachedProjectData = projectData;
            cachedAsmData = asm;

            if (typeof renderCollaborativeTable === 'function') {
                renderCollaborativeTable(projectData, asm);
            }

            if (asm.imageUrl) {
                const imgEl2 = document.getElementById('exam-img-display');
                const pdfEl2 = document.getElementById('exam-pdf-display');
                if (asm.imageUrl.toLowerCase().includes("pdf")) {
                    if(imgEl2) imgEl2.style.display = 'none';
                    if(pdfEl2) { pdfEl2.src = asm.imageUrl; pdfEl2.style.display = 'block'; }
                } else {
                    if(pdfEl2) pdfEl2.style.display = 'none';
                    if(imgEl2) { imgEl2.src = asm.imageUrl; imgEl2.style.display = 'block'; }
                }
                currentUploadedImageUrl = asm.imageUrl;

                const wrapper2 = document.getElementById('exam-inspector-wrapper');
                const toggleBtn = document.getElementById('exam-viewer-toggle-btn');
                if (wrapper2) {
                    wrapper2.style.display = 'flex'; 
                    if (toggleBtn) toggleBtn.innerText = "📄 시험지 닫기 🔼";
                }
            } else {
                // 이미지가 없는 폴더면 화면을 완벽 차단!
                const imgEl3 = document.getElementById('exam-img-display');
                const pdfEl3 = document.getElementById('exam-pdf-display');
                if (imgEl3) { imgEl3.src = ''; imgEl3.style.display = 'none'; }
                if (pdfEl3) { pdfEl3.src = ''; pdfEl3.style.display = 'none'; }
                
                const wrapper3 = document.getElementById('exam-inspector-wrapper');
                if (wrapper3) wrapper3.style.display = 'none';
                
                currentUploadedImageUrl = null;
            }
        }
    });
};


// ==========================================
// 📐 LaTeX 도우미 기능 제어 스크립트
// ==========================================

// 창 열고 닫기 토글 기능
window.toggleLatexHelper = function() {
    const helperWin = document.getElementById('latex-floating-window');
    if (!helperWin) return;
    
    if (helperWin.style.display === 'none' || helperWin.style.display === '') {
        helperWin.style.display = 'flex';
        // 창이 처음 열릴 때 드래그 이벤트 활성화 초기화
        initLatexHelperDrag();
    } else {
        helperWin.style.display = 'none';
    }
};

window.closeLatexHelper = function() {
    const helperWin = document.getElementById('latex-floating-window');
    if (helperWin) helperWin.style.display = 'none';
};

// 코드를 클릭하면 본문 내용 마우스 커서 위치 혹은 맨 뒤에 자동으로 수식 삽입하는 매커니즘
window.insertLatex = function(syntax) {
    const textarea = document.getElementById('journal-content');
    if (!textarea) return;

    const startPos = textarea.selectionStart;
    const endPos = textarea.selectionEnd;
    const currentVal = textarea.value;

    // 수식 기호 $ ... $ 로 감싸서 바로 복사되도록 편의 구성
    const textToInsert = `$${syntax}$`;

    textarea.value = currentVal.substring(0, startPos) + textToInsert + currentVal.substring(endPos, currentVal.length);
    
    // 포커스를 돌려주고 커서 위치를 삽입된 수식 바로 뒤로 이동
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = startPos + textToInsert.length;
};

// 마우스(PC) 및 터치(모바일) 드래그 이동을 위한 핵심 핸들러 바인딩
function initLatexHelperDrag() {
    const windowEl = document.getElementById('latex-floating-window');
    const headerEl = document.getElementById('latex-floating-header');
    if (!windowEl || !headerEl) return;

    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    
    // 💻 PC 마우스 이벤트 연결
    headerEl.onmousedown = dragMouseDown;
    // 📱 모바일 터치 이벤트 연결
    headerEl.ontouchstart = dragTouchStart;

    // --- PC 마우스 컨트롤 ---
    function dragMouseDown(e) {
        e = e || window.event;
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e = e || window.event;
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        windowEl.style.top = (windowEl.offsetTop - pos2) + "px";
        windowEl.style.left = (windowEl.offsetLeft - pos1) + "px";
    }

    // --- 모바일 터치 컨트롤 ---
    function dragTouchStart(e) {
        e = e || window.event;
        const touch = e.touches[0];
        pos3 = touch.clientX;
        pos4 = touch.clientY;
        document.ontouchend = closeDragElement;
        document.ontouchmove = elementTouchDrag;
    }

    function elementTouchDrag(e) {
        e = e || window.event;
        const touch = e.touches[0];
        pos1 = pos3 - touch.clientX;
        pos2 = pos4 - touch.clientY;
        pos3 = touch.clientX;
        pos4 = touch.clientY;
        windowEl.style.top = (windowEl.offsetTop - pos2) + "px";
        windowEl.style.left = (windowEl.offsetLeft - pos1) + "px";
    }

    // --- 드래그 종료 ---
    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
        document.ontouchend = null;
        document.ontouchmove = null;
    }
}

// ==========================================
// 🚀 다단계 수행평가 자동 생성 기능 (Step-up Performance Maker)
// ==========================================

function getNeisByteLength(str) {
    let byteLength = 0;
    for (let i = 0; i < str.length; i++) {
        byteLength += (str.charCodeAt(i) > 127) ? 3 : 1;
    }
    return byteLength;
}

function openPerformanceMaker() {
    showSection('performance-maker');
    const subjName = subjectData[currentSubject] ? subjectData[currentSubject].title : "과목 선택 필요";
    const subjNameEl = document.getElementById('perf-subject-name');
    if(subjNameEl) subjNameEl.innerText = subjName;
    
    // 💡 7가지 형식으로 확장된 드롭다운 세팅 (글쓰기와 구조화 분리)
    const formatSelect = document.getElementById('perf-format-select');
    if (formatSelect) {
        formatSelect.innerHTML = `
            <option value="단계적 서술형 평가 (수식 계산 및 논리 전개형)">단계적 서술형 평가 (수식 계산 및 논리 전개형)</option>
            <option value="오류 분석 및 수학적 논증 (오류 찾기, 반례, 증명형)">오류 분석 및 수학적 논증 (오류 찾기, 반례, 증명형)</option>
            <option value="수학적 모델링 (실생활 맥락 기반 최적해 찾기)">수학적 모델링 (실생활 맥락 기반 최적해 찾기)</option>
            <option value="학생 주도 문항 출제 (문제 만들기 및 해설 제작형)">학생 주도 문항 출제 (문제 만들기 및 해설 제작형)</option>
            <option value="공학도구 활용 탐구 (알지오매스/데스모스 활용 시각화)">공학도구 활용 탐구 (알지오매스/데스모스 활용 시각화)</option>
            <option value="수학적 글쓰기 (서론·본론·결론 에세이형)">수학적 글쓰기 (서론·본론·결론 에세이 및 융합 보고서형)</option>
            <option value="수학적 개념 구조화 (인포그래픽, 마인드맵)">수학적 개념 구조화 (인포그래픽, 마인드맵형)</option>
        `;
    }
    populatePerformanceStandards();
}

function populatePerformanceStandards() {
    const container = document.getElementById('perf-standard-container');
    if (!container) return;
    
    container.innerHTML = `
        <div class="perf-standard-row" style="display: flex; gap: 10px; align-items: center;">
            <select class="option-btn perf-standard-select" style="flex: 1; text-align: left; padding: 0.8rem; margin: 0;">
                <option value="">-- 문항의 기반이 될 성취기준을 선택하세요 --</option>
            </select>
            <button class="save-btn" onclick="addPerfStandardSelect()" style="width: auto; margin: 0; padding: 0.8rem 1rem; background: #3b82f6;">➕ 성취기준 융합(추가)</button>
        </div>
    `;
    fillStandardOptions(container.querySelector('.perf-standard-select'));
}

function addPerfStandardSelect() {
    const container = document.getElementById('perf-standard-container');
    const row = document.createElement('div');
    row.className = 'perf-standard-row';
    row.style.cssText = 'display: flex; gap: 10px; align-items: center; margin-top: 10px;';
    row.innerHTML = `
        <select class="option-btn perf-standard-select" style="flex: 1; text-align: left; padding: 0.8rem; margin: 0;">
            <option value="">-- 융합할 성취기준을 추가로 선택하세요 --</option>
        </select>
        <button class="save-btn" onclick="this.parentElement.remove()" style="width: auto; margin: 0; padding: 0.8rem 1rem; background: #ef4444;">❌ 삭제</button>
    `;
    container.appendChild(row);
    fillStandardOptions(row.querySelector('.perf-standard-select'));
}

function fillStandardOptions(selectEl) {
    if (!subjectData[currentSubject] || !subjectData[currentSubject].standards) return;
    subjectData[currentSubject].standards.forEach(std => {
        const option = document.createElement('option');
        option.value = std.code;
        option.dataset.l_high = std.levels?.high || '';
        option.dataset.l_b = std.levels?.b || '';
        option.dataset.l_mid = std.levels?.mid || '';
        option.dataset.l_d = std.levels?.d || '';
        option.dataset.l_low = std.levels?.low || '';
        option.innerText = `${std.code} ${std.desc.substring(0, 30)}...`;
        selectEl.appendChild(option);
    });
}

async function executePerformanceGeneration() {
    const isLoggedIn = await checkLogin();
    if (!isLoggedIn) return;
    if (!requireApiKey()) return;

    const selects = document.querySelectorAll('.perf-standard-select');
    let stdInfoForAI = "";
    let selectedCount = 0;

    selects.forEach((sel, idx) => {
        if (sel.value) {
            const opt = sel.options[sel.selectedIndex];
            stdInfoForAI += `[성취기준 ${idx + 1}] ${opt.innerText}\n(A수준: ${opt.dataset.l_high} / B수준: ${opt.dataset.l_b} / C수준: ${opt.dataset.l_mid} / D수준: ${opt.dataset.l_d} / E수준: ${opt.dataset.l_low})\n\n`;
            selectedCount++;
        }
    });

    if (selectedCount === 0) {
        alert("최소 1개 이상의 성취기준을 선택해주세요!");
        return;
    }

    const checkedComps = Array.from(document.querySelectorAll('#perf-competencies input:checked')).map(cb => cb.value);
    if (checkedComps.length === 0) {
        alert("반영할 교과 역량을 최소 1개 이상 선택해주세요.");
        return;
    }

    const format = document.getElementById('perf-format-select').value;

    const btn = document.getElementById('btn-generate-perf');
    const originalText = btn.innerText;
    btn.innerText = "⏳ AI가 융합 문항과 다차원 매트릭스 루브릭을 설계 중입니다...";
    btn.disabled = true;

    const resultZone = document.getElementById('perf-result-zone');
    const contentBox = document.getElementById('perf-output-content');
    resultZone.style.display = 'block';
    contentBox.innerHTML = '<p style="text-align:center; color:#c026d3; font-weight:bold; padding:2rem;">성취기준 융합 및 매트릭스 루브릭 설계로 인해 최대 30초가 소요될 수 있습니다. 🪄</p>';

    try {
        const workerUrl = "https://script.google.com/macros/s/AKfycbwgx4RgF8FQxxL3jBgEQ5l369llADjhZ1NepulIdF4DdX18kBrB8oRQ4Ft0d5WdKtEF/exec";
        const userApiKey = localStorage.getItem('gemini_api_key');

        const response = await fetch(workerUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: "generate_performance",
                standardsInfo: stdInfoForAI,
                assessmentFormat: format,
                selectedCompetencies: checkedComps.join(", "),
                apiKey: userApiKey
            })
        });

        await checkApiError(response);
        const data = await response.json();
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        
        const aiJsonString = data.candidates[0].content.parts[0].text;
        const cleanJsonStr = aiJsonString.replace(/```json\n?/gi, '').replace(/```/g, '').trim();
        const resultData = JSON.parse(cleanJsonStr);

        const levelColors = { 'E': '#ef4444', 'D': '#f97316', 'C': '#f59e0b', 'B': '#3b82f6', 'A': '#10b981' };

        // 🌟 1. 학생용 평가지 (질문 먼저 노출)
        let studentHtml = `
            <div style="background:white; border: 1px solid #cbd5e1; border-top: 5px solid #d946ef; border-radius: 12px; padding: 2rem; margin-bottom: 2rem; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 2px solid #f1f5f9; padding-bottom: 10px;">
                    <h3 style="margin:0; color:#1e3a8a; font-size: 1.3rem;">🧑‍🎓 학생용 수행평가지</h3>
                    <span style="background:#fdf4ff; color:#a21caf; padding:4px 10px; border-radius:20px; font-size:0.8rem; font-weight:bold;">${format.split(' ')[0]}</span>
                </div>
                
                <h4 style="margin:0 0 15px 0; color:#0f172a; text-align: center; font-size: 1.2rem;">${resultData.assessmentTitle}</h4>
                
                <div style="background: #f8fafc; padding: 15px; border-radius: 8px; font-size: 1rem; line-height: 1.7; color: #1e293b; margin-bottom: 20px; border: 1px dashed #cbd5e1;">
                    <strong style="color:#0f172a;">[탐구 상황 및 과제]</strong><br>
                    ${resultData.context.replace(/\n/g, '<br>')}
                </div>
                <div style="display:flex; flex-direction:column; gap:15px;">
        `;

        resultData.steps.forEach(step => {
            const color = levelColors[step.level] || '#64748b';
            studentHtml += `
                <div style="padding: 10px 15px; border-bottom: 1px dashed #e2e8f0;">
                    <div style="font-weight: bold; font-size: 0.9rem; color: ${color}; margin-bottom: 6px;">${step.title}</div>
                    <div style="font-size: 1rem; color: #0f172a; line-height: 1.6;">${step.question.replace(/\n/g, '<br>')}</div>
                    <div style="margin-top: 10px; min-height: 60px; background: #fdfcfa; border: 1px solid #e2e8f0; border-radius: 4px; padding: 10px; color: #cbd5e1; font-size: 0.8rem; text-align: center; display: flex; align-items: center; justify-content: center;">
                        (학생 풀이 작성 공간)
                    </div>
                </div>
            `;
        });
        studentHtml += `</div></div>`;

        // 🌟 2. 교사용 모범 정답
        let teacherHtml = `
            <div style="background:white; border: 1px solid #cbd5e1; border-top: 5px solid #1e3a8a; border-radius: 12px; padding: 2rem; margin-bottom: 2rem; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                <h3 style="margin:0 0 15px 0; color:#1e3a8a; border-bottom: 2px solid #f1f5f9; padding-bottom: 10px; font-size: 1.3rem;">👨‍🏫 교사용 해설 및 평가 루브릭</h3>
                <h4 style="margin:0 0 10px 0; color:#0f766e;">💡 단계별 모범 정답</h4>
                <div style="display:flex; flex-direction:column; gap:10px; margin-bottom: 25px;">
        `;

        resultData.steps.forEach(step => {
            const color = levelColors[step.level] || '#64748b';
            teacherHtml += `
                <div style="background: #e0f2fe; border-left: 4px solid ${color}; padding: 12px 15px; border-radius: 4px;">
                    <strong style="color: ${color}; font-size: 0.85rem;">[${step.title}]</strong>
                    <div style="margin-top: 5px; font-size: 0.95rem; color: #1e3a8a; line-height: 1.6;">${step.answer.replace(/\n/g, '<br>')}</div>
                </div>
            `;
        });

        // 🌟 3. 매트릭스(표) 형태의 다차원 평가 루브릭 렌더링
        teacherHtml += `
                </div>
                <h4 style="margin:0 0 10px 0; color:#0f766e;">📊 평가 요소별 다차원 성취수준 루브릭</h4>
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; min-width: 800px; font-size: 0.85rem; text-align: left;">
                        <thead style="background: #f1f5f9; color: #334155;">
                            <tr>
                                <th style="border:1px solid #cbd5e1; padding:10px; text-align:center; width: 15%;">평가 요소 ↓</th>
                                <th style="border:1px solid #cbd5e1; padding:10px; text-align:center; color:#15803d;">수준 A</th>
                                <th style="border:1px solid #cbd5e1; padding:10px; text-align:center; color:#1d4ed8;">수준 B</th>
                                <th style="border:1px solid #cbd5e1; padding:10px; text-align:center; color:#b45309;">수준 C</th>
                                <th style="border:1px solid #cbd5e1; padding:10px; text-align:center; color:#c2410c;">수준 D</th>
                                <th style="border:1px solid #cbd5e1; padding:10px; text-align:center; color:#b91c1c;">수준 E</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        resultData.rubric_matrix.forEach(row => {
            teacherHtml += `
                <tr>
                    <th style="border:1px solid #cbd5e1; padding:10px; background: #f8fafc; text-align:center; word-break: keep-all; font-weight:bold; color:#1e40af;">${row.element}</th>
                    <td style="border:1px solid #cbd5e1; padding:10px;">${row.A}</td>
                    <td style="border:1px solid #cbd5e1; padding:10px;">${row.B}</td>
                    <td style="border:1px solid #cbd5e1; padding:10px;">${row.C}</td>
                    <td style="border:1px solid #cbd5e1; padding:10px;">${row.D}</td>
                    <td style="border:1px solid #cbd5e1; padding:10px;">${row.E}</td>
                </tr>
            `;
        });
        teacherHtml += `</tbody></table></div></div>`;

        // 🌟 4. A~E 생기부 세특 초안 및 바이트 계산기
        let neisHtml = `
            <div style="background:white; border: 1px solid #fef08a; border-top: 5px solid #eab308; border-radius: 12px; padding: 2rem; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
                <h3 style="margin:0 0 15px 0; color:#854d0e; border-bottom: 2px solid #fefce8; padding-bottom: 10px; font-size: 1.3rem;">💾 수준별 학교생활기록부 세특 기재 초안</h3>
                <div style="margin-bottom: 15px; font-size: 0.85rem; color: #a16207;">💡 성취 수준별로 학생의 역량, 참여도, <b>확장 및 발전 가능성</b>이 깊이 있게 포함되어 있습니다.</div>
                <div style="display:flex; flex-direction:column; gap:15px;">
        `;

        ['A', 'B', 'C', 'D', 'E'].forEach(lvl => {
            const neisText = resultData.neis[lvl] || "데이터 생성 오류";
            const neisByte = getNeisByteLength(neisText);
            const byteColor = neisByte > 1500 ? "#ef4444" : "#15803d";
            const lvlColor = levelColors[lvl];

            neisHtml += `
                <div style="border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
                    <div style="background: #f8fafc; padding: 10px 15px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
                        <strong style="color: ${lvlColor}; font-size: 1.05rem;">${lvl}수준 도달 학생</strong>
                        <span style="font-size: 0.8rem; background: #fef08a; padding: 4px 10px; border-radius: 12px; color: ${byteColor}; font-weight: bold;">총 ${neisByte} Byte</span>
                    </div>
                    <div style="padding: 15px; font-size: 0.95rem; color: #334155; line-height: 1.6; background: #fffcf8;">
                        ${neisText}
                    </div>
                </div>
            `;
        });
        neisHtml += `</div></div>`;

        // 최종 출력 조립
        contentBox.innerHTML = studentHtml + teacherHtml + neisHtml;

        if (window.MathJax) {
            MathJax.typesetClear([contentBox]);
            MathJax.typesetPromise([contentBox]);
        }

    } catch (e) {
        contentBox.innerHTML = `<div style="padding:1rem; background:#fee2e2; border-left:4px solid #ef4444; color:#b91c1c; border-radius:4px;"><strong>오류 발생:</strong> ${e.message}<br><br><span style="font-size:0.85rem;">(잠시 후 다시 버튼을 눌러주세요.)</span></div>`;
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
}


// 기존 exposeToWindow 개체가 하단에 선언되어 있다면 아래 항목들을 매핑 추가해주세요.
// toggleLatexHelper, closeLatexHelper, insertLatex

// ==========================================
// 🌟 [최종 업데이트] Vite 모듈 환경에서 HTML 버튼들이 함수를 찾을 수 있도록 외부(window)로 연결해주는 마법의 다리
// ==========================================
const exposeToWindow = {
    handleLogin, handleLogout, handleDeleteAccount, openFeedback, openAdminFeedback,
    openAdminMode, openSettings, closeSettings, closeFeedback, closeModal,
    closeAdminFeedback, saveApiKey, submitFeedback, showSection,
    openAnalysisMode, startLevelMatching, checkLevelAnswer, nextLevelQuestion,
    backToStandardSelection, saveChecklist, openModal, loadBookmark, openBookmarkModal,
    closeBookmarkModal, createNewProject, backToProjectList, openManualAssessmentModal,
    closeManualAssessmentModal, generateEmptyScoreTable,
    downloadScoreTemplate, handleExcelUpload, openAiHelper, 
    handleNextToPath1Result, goBackStep, saveAssessmentToProject, saveWrittenAssessmentShell,
    addSubFactorRow, removeSubFactorRow, calculateSubFactorsTotal, saveStandardToDB,
    loadStandardsForEdit, populateEditFields, updateStandardInDB, deleteStandardFromDB,
    loadStandardsForQuestion, saveQuestionToDB, loadStandardsForManage, loadQuestionsForEdit,
    populateQuestionEditFields, updateQuestionInDB, deleteQuestionFromDB, updateUniversalFilter,
    downloadUniversalData, uploadUniversalData, handleImageUpload, setAnalysisMode,
    executeAnalysis, triggerSaveBackgroundAndReset, resetAnalysis, sendChatMessage,
    submitSpecificFeedback, acceptFeedback, rejectFeedback, updateMathPreview,
    startPartialCapture, pasteImageToQuestion, saveBankAndApplyTable, sendAiResultsToTable,
    deleteProject, inviteCollaborator, kickFromProject, openProject, toggleGlobalEditMode,
    editManualAssessment, deleteAssessment, updateBaseDifficulty,
    updateBaseScore, saveMyInput, copyAiLevelsToMine, applyBatchDifficulty,
    calculateTotalCutScores, openSpecificFeedbackPanel, updateStep2Total, markAsReady, goToStep, updateQuestionCount,
    
    deleteQuestion, mergeWithPrevious, removeQuestionImage, deleteTableQuestion, toggleAiVisibility,
    removePreviewImage,   
    changeGroup, openMemoBoard, closeMemoBoard, submitMemo, changeSubject, showAiReason,
    toggleDictionaryPanel, changeDictGroup, loadDictionaryStandards, toggleAccordion,
    toggleCommonPassageTray, handlePassageFiles, pastePassageFromClipboard, removePassage, 
    toggleExamRangeInputs, previewExamFile, executeExamAnalysis, resetAiLevels,
    prevLevelQuestion, skipLevelQuestion, saveAndClosePassageTray,   clearAllPassages,
    resetChecklist, openJournalModal, closeJournalModal, saveJournalEntry, deleteJournalEntry, saveUserSubjectGroup,
    silentSaveChecklist, downloadAllJournalsExcel, cancelSubjectSelection, initDictionaryDrag, markAsModified,
    openCompareModal, resetMCutScores, enableMEditMode,

    loadManualAssessmentWorkspace, toggleManualCompareMode, saveManualAssessmentToProject, enableManualEditMode,
    resetManualScores, syncManualStructureFromDB, addManualTableQuestion, openReadOnlyExamViewer,
    toggleLatexHelper, closeLatexHelper, insertLatex, runTweezerRepair,
    // 👇👇👇 여기에 새로운 수행평가 함수 3가지를 추가했습니다! 👇👇👇
    openPerformanceMaker, populatePerformanceStandards, executePerformanceGeneration, addPerfStandardSelect
};

for (const [fnName, fn] of Object.entries(exposeToWindow)) {
    window[fnName] = fn;
}