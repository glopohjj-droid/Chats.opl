import React, { useEffect, useState, useRef, FormEvent } from "react";
import { 
  onAuthStateChanged, 
  User 
} from "firebase/auth";
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  doc, 
  setDoc, 
  getDoc, 
  serverTimestamp, 
  limit, 
  getDocFromServer
} from "firebase/firestore";
import { 
  auth, 
  db, 
  signInWithGoogle, 
  logOut, 
  handleFirestoreError, 
  OperationType 
} from "./firebase";
import { Message, UserProfile } from "./types";
import { 
  Send, 
  Bot, 
  Users, 
  Sparkles, 
  Brain, 
  LogOut, 
  MessageSquare, 
  ChevronDown, 
  ChevronUp, 
  Terminal, 
  AlertCircle,
  HelpCircle,
  Shield,
  Clock,
  Code
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export default function App() {
  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Firestore status
  const [dbConnected, setDbConnected] = useState<boolean | null>(null);

  // Chat data
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeProfiles, setActiveProfiles] = useState<UserProfile[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);

  // User input
  const [input, setInput] = useState("");
  const [summonAi, setSummonAi] = useState(false); // Toggle to summon AI Thinker for AI help
  const [aiThinking, setAiThinking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Scroll references
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // State to track expanded reasoning steps for individual messages
  const [expandedReasoning, setExpandedReasoning] = useState<Record<string, boolean>>({});

  // Verify Firestore Connection on Mount
  useEffect(() => {
    async function verifyDb() {
      try {
        await getDocFromServer(doc(db, "test", "connection"));
        setDbConnected(true);
      } catch (error) {
        console.warn("Expected placeholder warning about missing test doc - Firebase connection active.");
        setDbConnected(true);
      }
    }
    verifyDb();
  }, []);

  // Handle Auth State Changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setAuthLoading(true);
      if (currentUser) {
        setUser(currentUser);
        
        // Setup User profile in Firestore (/users/{uid})
        const userRef = doc(db, "users", currentUser.uid);
        try {
          const userSnap = await getDoc(userRef);
          if (!userSnap.exists()) {
            await setDoc(userRef, {
              uid: currentUser.uid,
              displayName: currentUser.displayName || currentUser.email?.split("@")[0] || "Anonymous",
              photoURL: currentUser.photoURL || "",
              email: currentUser.email || "",
              createdAt: serverTimestamp()
            });
          } else {
            // Incremental non-destructive merge
            await setDoc(userRef, {
              ...userSnap.data(),
              photoURL: currentUser.photoURL || "",
              displayName: currentUser.displayName || currentUser.email?.split("@")[0] || "Anonymous",
            });
          }
        } catch (error) {
          console.error("Failed to register/sync user profile details securely:", error);
        }
      } else {
        setUser(null);
      }
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Sync Messages and Profiles in real-time when user is authenticated
  useEffect(() => {
    if (!user) {
      setMessages([]);
      setActiveProfiles([]);
      return;
    }

    setMessagesLoading(true);

    // 1. Sync messages feed (limit to 100 for fast initial loading)
    const messagesPath = "messages";
    const messagesQuery = query(
      collection(db, messagesPath),
      orderBy("createdAt", "asc"),
      limit(100)
    );

    const unsubscribeMessages = onSnapshot(
      messagesQuery,
      (snapshot) => {
        const msgs: Message[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          msgs.push({
            id: doc.id,
            text: data.text || "",
            userId: data.userId || "",
            userName: data.userName || "",
            userPhoto: data.userPhoto || "",
            createdAt: data.createdAt,
            isAi: !!data.isAi,
            thinkingText: data.thinkingText || ""
          });
        });
        setMessages(msgs);
        setMessagesLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, messagesPath);
        setErrorMessage("Превышена квота или отсутствуют права доступа к базе данных.");
        setMessagesLoading(false);
      }
    );

    // 2. Sync online user profiles registered in this app
    const usersPath = "users";
    const usersQuery = query(
      collection(db, usersPath),
      orderBy("createdAt", "desc"),
      limit(25)
    );

    const unsubscribeUsers = onSnapshot(
      usersQuery,
      (snapshot) => {
        const profiles: UserProfile[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          profiles.push({
            uid: data.uid || "",
            displayName: data.displayName || "",
            photoURL: data.photoURL || "",
            email: data.email || "",
            createdAt: data.createdAt
          });
        });
        setActiveProfiles(profiles);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, usersPath);
      }
    );

    return () => {
      unsubscribeMessages();
      unsubscribeUsers();
    };
  }, [user]);

  // Handle Automatic Scroll Snap
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, aiThinking]);

  const handleSignIn = async () => {
    try {
      setErrorMessage(null);
      await signInWithGoogle();
    } catch (err: any) {
      setErrorMessage("Ошибка входа через Google. Попробуйте еще раз.");
    }
  };

  const handleLogOut = async () => {
    try {
      await logOut();
    } catch (err) {
      console.error(err);
    }
  };

  const toggleReasoning = (msgId: string) => {
    setExpandedReasoning((prev) => ({
      ...prev,
      [msgId]: !prev[msgId]
    }));
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !user) return;

    setErrorMessage(null);
    const textToSend = input;
    setInput("");

    // Detect if calling AI implicitly starting with @ai or if toggle is true
    const shouldCallAi = summonAi || textToSend.toLowerCase().startsWith("@ai");

    // Create unique ID
    const msgRef = doc(collection(db, "messages"));
    const messageId = msgRef.id;

    // Build user message body
    const userMessage: Message = {
      id: messageId,
      text: textToSend,
      userId: user.uid,
      userName: user.displayName || user.email?.split("@")[0] || "Anonymous",
      userPhoto: user.photoURL || "",
      createdAt: serverTimestamp() as any,
      isAi: false
    };

    // 1. Submit standard user message to Firestore
    try {
      await setDoc(msgRef, userMessage);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `messages/${messageId}`);
      setErrorMessage("Ошибка отправки сообщения в БД.");
      return;
    }

    // 2. Summon server-side Gemini 3.1 Pro Thinking Assistant if flagged or starting with @ai
    if (shouldCallAi) {
      setAiThinking(true);
      setSummonAi(false); // Reset toggle for next chat

      try {
        // Collect historic context of chat to feed to our thinking model
        const recentHistory = messages.slice(-8).map((m) => ({
          text: m.text,
          isAi: m.isAi
        }));

        // Query our secure node proxy endpoint
        const response = await fetch("/api/chat/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: textToSend,
            history: recentHistory
          })
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || "Failed to retrieve AI insights.");
        }

        const data = await response.json();

        // 3. Save AI message output with its thinking process back to database
        const aiMsgRef = doc(collection(db, "messages"));
        const aiMsgId = aiMsgRef.id;

        const aiMessage = {
          id: aiMsgId,
          text: data.text || "Извините, у меня не получилось сформулировать ответ.",
          userId: "ai-assistant",
          userName: "AI Thinker (Gemini 3.1 Pro)",
          userPhoto: "https://www.gstatic.com/mobilesdk/250721_mobilesdk/mono_firebase_dark.svg",
          createdAt: serverTimestamp(),
          isAi: true,
          thinkingText: data.thinkingText || ""
        };

        await setDoc(aiMsgRef, aiMessage);

      } catch (err: any) {
        console.error("AI Assistant error:", err);
        setErrorMessage(`Упс! Произошла ошибка AI: ${err.message || "проверьте ключ в Secrets."}`);
      } finally {
        setAiThinking(false);
      }
    }
  };

  // Helper to format timestamps gracefully
  const formatTime = (createdAt: any) => {
    if (!createdAt) return "Сейчас";
    const date = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 text-slate-900" id="loading-container">
        <div className="flex flex-col items-center space-y-4">
          <Brain className="w-12 h-12 text-indigo-600 animate-pulse" />
          <h2 className="text-lg font-medium tracking-tight font-sans">Инициализация чата...</h2>
        </div>
      </div>
    );
  }

  // --- 1. LOGIN LANDING VIEW SCREEN ---
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 p-6" id="login-container">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-8 shadow-sm text-center relative overflow-hidden">
          
          {/* Subtle Ambient Decorative Ring */}
          <div className="absolute -top-12 -right-12 w-32 h-32 bg-indigo-50 rounded-full blur-2xl opacity-70" />
          
          <div className="mb-6 inline-flex p-4 bg-indigo-55/10 bg-indigo-50 text-indigo-600 rounded-2xl" id="logo-icon">
            <MessageSquare className="w-10 h-10" />
          </div>

          <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-2">Общий Чат & AI Thinker</h1>
          <p className="text-sm text-slate-500 max-w-sm mx-auto mb-8">
            Добро пожаловать в глобальный чат! Общайтесь со всеми подключенными пользователями в реальном времени и призывайте интеллект **Gemini 3.1 Pro** для умных рассуждений.
          </p>

          {errorMessage && (
            <div className="mb-6 p-4 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-start space-x-2 text-left" id="login-error">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Secure Firebase Sign In Feature */}
          <button
            onClick={handleSignIn}
            className="w-full flex items-center justify-center space-x-3 py-3.5 px-4 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-xl transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 cursor-pointer"
            id="google-signin-btn"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            <span>Войти с Google</span>
          </button>

          <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-center space-x-4 text-xs text-slate-400">
            <span className="flex items-center"><Shield className="w-3.5 h-3.5 mr-1" /> Безопасно</span>
            <span>•</span>
            <span className="flex items-center"><Clock className="w-3.5 h-3.5 mr-1" /> В реальном времени</span>
          </div>
        </div>
      </div>
    );
  }

  // --- 2. MAIN FULL-STACK CHAT VIEW ---
  return (
    <div className="flex h-screen bg-slate-100 text-slate-900 overflow-hidden font-sans" id="chat-app-container">
      <div className="flex-1 max-w-7xl mx-auto w-full flex h-full p-4 lg:py-6 gap-4">
        
        {/* LEFT COMPONENT: SIDEBAR (Profiles & Status) */}
        <div className="hidden md:flex flex-col w-72 bg-white border border-slate-200 rounded-3xl overflow-hidden p-5 shadow-sm" id="chat-sidebar">
          
          {/* Header User profile */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-5" id="user-profile-header">
            <div className="flex items-center space-x-3 overflow-hidden">
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || "User"} className="w-10 h-10 rounded-full border border-slate-200" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold">
                  {user.displayName?.[0]?.toUpperCase() || "U"}
                </div>
              )}
              <div className="text-left overflow-hidden">
                <p className="text-sm font-semibold text-slate-900 truncate">{user.displayName}</p>
                <p className="text-xs text-slate-500 truncate">{user.email}</p>
              </div>
            </div>
            
            <button 
              onClick={handleLogOut} 
              className="p-1 px-[7px] text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
              title="Выйти"
              id="logout-btn"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>

          {/* Active room indicator */}
          <div className="mb-6">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2 px-1">АКТИВНЫЙ ЧАТ</p>
            <div className="flex items-center space-x-3 p-3 bg-indigo-50 border border-indigo-100/50 rounded-xl text-indigo-700">
              <MessageSquare className="w-5 h-5 flex-shrink-0" />
              <div className="text-left">
                <span className="font-semibold text-sm">#general</span>
                <p className="text-[10px] text-indigo-500">Общая комната</p>
              </div>
            </div>
          </div>

          {/* Connected AI Engine Card */}
          <div className="mb-6 p-4 bg-slate-50 border border-slate-200/60 rounded-2xl relative overflow-hidden">
            <div className="flex items-center space-x-2 text-indigo-600 mb-2">
              <Brain className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">AI Thinker Active</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed mb-1">
              **Модель**: `gemini-3.1-pro-preview`
            </p>
            <p className="text-xs text-slate-500 leading-relaxed">
              **Уровень рассуждения**: `HIGH`
            </p>
            <div className="absolute right-2 bottom-2 text-slate-200 pointer-events-none">
              <Sparkles className="w-10 h-10" />
            </div>
          </div>

          {/* Active members feed */}
          <div className="flex-1 flex flex-col min-h-0" id="users-container">
            <div className="flex items-center space-x-2 pb-2 text-xs font-semibold text-slate-400 uppercase tracking-widest px-1">
              <Users className="w-3.5 h-3.5" />
              <span>Участники ({activeProfiles.length})</span>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {activeProfiles.map((p) => (
                <div key={p.uid} className="flex items-center space-x-2.5 p-2 rounded-xl border border-transparent hover:border-slate-100 hover:bg-slate-50 transition-all">
                  {p.photoURL ? (
                    <img src={p.photoURL} alt={p.displayName} className="w-7 h-7 rounded-full border border-slate-200" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center font-bold text-xs">
                      {p.displayName?.[0]?.toUpperCase() || "M"}
                    </div>
                  )}
                  <div className="text-left overflow-hidden flex-1">
                    <p className="text-xs font-medium text-slate-800 truncate">{p.displayName}</p>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Участник</span>
                  </div>
                  {p.uid === user.uid && (
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" title="Вы" />
                  )}
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* RIGHT COMPONENT: MAIN CHAT INTERFACE & INPUT */}
        <div className="flex-1 flex flex-col bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm relative h-full" id="chat-board">
          
          {/* Top Board Bar */}
          <div className="flex items-center justify-between p-4 border-b border-slate-100" id="chat-board-header">
            <div className="flex items-center space-x-3 text-left">
              <div className="md:hidden flex items-center justify-center p-2 rounded-xl bg-indigo-50 text-indigo-600">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center">
                  #general
                  <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
                    В эфире
                  </span>
                </h2>
                <p className="text-xs text-slate-550 text-slate-500">Глобальная комната для всех пользователей</p>
              </div>
            </div>

            {/* Micro mobile logout trigger */}
            <div className="flex items-center space-x-2">
              <button 
                onClick={handleLogOut} 
                className="md:hidden flex items-center p-2 text-slate-400 hover:text-rose-600 rounded-xl hover:bg-rose-50"
                id="mobile-logout-btn"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Database connections & Warning messages */}
          {errorMessage && (
            <div className="p-3 bg-rose-50 border-b border-rose-100 text-rose-700 text-xs flex items-center justify-between px-4 transition-all">
              <div className="flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{errorMessage}</span>
              </div>
              <button onClick={() => setErrorMessage(null)} className="text-xs font-semibold hover:underline">Скрыть</button>
            </div>
          )}

          {/* CHAT MESSAGES PANEL */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50 custom-scrollbar" id="messages-panel">
            {messagesLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-450 text-slate-400 space-y-2">
                <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs">Загрузка сообщений...</span>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-3 p-6">
                <div className="p-4 bg-indigo-50 text-indigo-600 rounded-full">
                  <MessageSquare className="w-8 h-8" />
                </div>
                <h3 className="text-sm font-semibold text-slate-700">Комната полностью пуста</h3>
                <p className="text-xs text-slate-500 max-w-xs">Будьте первым! Задайте тему разговора или призовите **искусственный интеллект AI** для обсуждения.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((msg, idx) => {
                  const isCurrentUser = msg.userId === user.uid;
                  
                  return (
                    <div 
                      key={msg.id || idx} 
                      className={`flex items-start space-x-3 max-w-[85%] ${isCurrentUser ? "ml-auto flex-row-reverse space-x-reverse" : ""}`}
                    >
                      {/* Message Author Avatar */}
                      {msg.userPhoto ? (
                        <img 
                          src={msg.userPhoto} 
                          alt={msg.userName} 
                          className="w-8 h-8 rounded-full border border-slate-200 flex-shrink-0"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0 ${msg.isAi ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-600"}`}>
                          {msg.userName?.[0]?.toUpperCase() || "?"}
                        </div>
                      )}

                      <div className="flex flex-col text-left">
                        {/* Meta information tags */}
                        <div className={`flex items-center space-x-2 mb-1 ${isCurrentUser ? "justify-end" : ""}`}>
                          <span className="text-xs font-semibold text-slate-800">{msg.userName}</span>
                          {msg.isAi && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-indigo-100 text-indigo-700 border border-indigo-200">
                              <Sparkles className="w-2.5 h-2.5 mr-0.5" /> AI BOT
                            </span>
                          )}
                          <span className="text-[10px] text-slate-400">{formatTime(msg.createdAt)}</span>
                        </div>

                        {/* Text Content Bubble */}
                        <div 
                          className={`p-3.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap shadow-sm border ${
                            isCurrentUser 
                              ? "bg-indigo-600 text-white border-indigo-500 rounded-tr-none" 
                              : msg.isAi 
                                ? "bg-slate-900 text-slate-100 border-slate-800 rounded-tl-none font-sans" 
                                : "bg-white text-slate-850 border-slate-200/70 rounded-tl-none text-slate-800"
                          }`}
                        >
                          {msg.text}
                        </div>

                        {/* Gemini 3 reasoning panel (if present) */}
                        {msg.isAi && msg.thinkingText && (
                          <div className="mt-1.5 border border-amber-200/80 bg-amber-50/70 rounded-xl p-3 text-xs text-amber-900 max-w-lg transition-all shadow-inner">
                            <button 
                              onClick={() => toggleReasoning(msg.id)} 
                              className="w-full flex items-center justify-between text-amber-800 hover:text-amber-950 font-semibold mb-1 cursor-pointer focus:outline-none"
                            >
                              <span className="flex items-center"><Brain className="w-3.5 h-3.5 mr-1 text-amber-600 animate-pulse" /> Показать процесс мышления (Thinking Module)</span>
                              {expandedReasoning[msg.id] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                            
                            {expandedReasoning[msg.id] && (
                              <motion.div 
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                className="font-mono bg-amber-100/60 p-2.5 rounded-lg text-[11px] overflow-x-auto text-amber-950 whitespace-pre-wrap leading-relaxed mt-1"
                              >
                                <div className="flex items-center space-x-1 mb-1 text-amber-700 font-sans font-bold">
                                  <Terminal className="w-3 h-3 text-amber-600" />
                                  <span>LOGS [ThinkingLevel: HIGH]</span>
                                </div>
                                {msg.thinkingText}
                              </motion.div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* AI RESPONDING LOADING INDICATOR STATE */}
                {aiThinking && (
                  <div className="flex items-start space-x-3 max-w-[85%]">
                    <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-xs flex-shrink-0 animate-pulse">
                      AI
                    </div>
                    <div className="flex flex-col text-left">
                      <div className="flex items-center space-x-2 mb-1">
                        <span className="text-xs font-semibold text-slate-850">AI Thinker (Gemini 3.1 Pro)</span>
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-50 border border-amber-200 text-amber-800 animate-pulse">
                          Рассуждаю...
                        </span>
                      </div>
                      
                      {/* Simulated thinking display block */}
                      <div className="p-3.5 bg-slate-900 text-slate-100 border border-slate-800 rounded-2xl rounded-tl-none text-sm leading-relaxed shadow-sm min-w-[200px]">
                        <div className="flex space-x-1.5 py-2 items-center justify-start">
                          <span className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* CHAT INPUT AREA PANEL */}
          <div className="p-4 border-t border-slate-100 bg-white" id="input-container">
            <form onSubmit={handleSendMessage} className="space-y-3">
              
              {/* Summons AI Selector Action */}
              <div className="flex items-center justify-between text-xs px-1">
                <div className="flex items-center space-x-2 text-slate-500">
                  <span className="text-[10px] text-slate-400">Подсказка: напишите <code className="bg-slate-100 text-indigo-600 px-1 py-0.5 rounded font-mono">@ai</code> или активируйте тумблер справа</span>
                </div>
                
                <button
                  type="button"
                  onClick={() => setSummonAi(!summonAi)}
                  className={`flex items-center space-x-1.5 py-1 px-3.5 rounded-full font-semibold transition-all border outline-none cursor-pointer ${
                    summonAi 
                      ? "bg-indigo-600 text-white border-indigo-500 shadow-sm" 
                      : "bg-slate-50 hover:bg-slate-100 text-slate-600 border-slate-200"
                  }`}
                  id="summon-ai-toggle"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${summonAi ? "animate-spin" : ""}`} />
                  <span>Спросить AI Thinker</span>
                </button>
              </div>

              {/* Message Box and Submit Action */}
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Напишите сообщение в #general..."
                  className="flex-1 bg-slate-50 border border-slate-200 text-slate-850 placeholder-slate-400 text-sm py-3 px-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all text-slate-800"
                  id="message-input-textbox"
                  disabled={aiThinking}
                />
                
                <button
                  type="submit"
                  disabled={!input.trim() || aiThinking}
                  className="p-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-350 text-white rounded-xl transition-all shadow-sm flex items-center justify-center flex-shrink-0 cursor-pointer"
                  id="send-message-btn"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </form>
          </div>

        </div>

      </div>
    </div>
  );
}
