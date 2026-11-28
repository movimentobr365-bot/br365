window.__radarPushModuleReady = false;

(async () => {
  const status = document.getElementById("pushStatus");
  const setStatus = (message, error = false) => {
    if (!status) return;
    status.textContent = message;
    status.style.color = error ? "#a12622" : "";
  };

  try {
    // Dynamic imports let the page show the actual CDN/import error instead of
    // silently falling back to a normal form submission.
    const [appSdk, authSdk, firestoreSdk, messagingSdk] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js"),
      import("https://www.gstatic.com/firebasejs/13.4.0/firebase-messaging.js")
    ]);

    const { initializeApp } = appSdk;
    const { getAuth, signInAnonymously } = authSdk;
    const { getFirestore, doc, writeBatch, deleteDoc, serverTimestamp } = firestoreSdk;
    const { getMessaging, isSupported, onRegistered, register, unregister, onMessage } = messagingSdk;

    const firebaseConfig = {
      apiKey: "AIzaSyCTPsOy1bmd3ob3oYfEhKDfJIa3ZS2I8as",
      authDomain: "radar-br-365.firebaseapp.com",
      projectId: "radar-br-365",
      storageBucket: "radar-br-365.firebasestorage.app",
      messagingSenderId: "779247236992",
      appId: "1:779247236992:web:cb745ebc4e14c075b8b365"
    };

    const VAPID_PUBLIC_KEY = "BCnAzMogcWV_W44x9n8AyfS91ONBO_AjdboIy37QPW5uv2j3ne39NRq7lm5ldNZKwUrLDutfKe0MbCGBXtAMWJA";
    const SITE_URL = "https://www.movimentobr365.com.br/#painel";

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const db = getFirestore(app);

    const form = document.getElementById("formPush");
    const enableButton = document.getElementById("ativarPush");
    const disableButton = document.getElementById("desativarPush");
    const deleteContactButton = document.getElementById("excluirContato");
    const profileRadios = [...document.querySelectorAll('input[name="perfil"]')];
    const companyWrap = document.getElementById("pushJuridicaWrap");
    const companyNameInput = document.getElementById("pushEmpresa");

    let currentMessaging = null;
    let currentRegistration = null;
    let foregroundUnsubscribe = null;

    function selectedProfile() {
      return form?.querySelector('input[name="perfil"]:checked')?.value || "";
    }

    function updateProfileFields() {
      const isCompany = selectedProfile() === "Pessoa jurídica";
      if (companyWrap) companyWrap.hidden = !isCompany;
      if (companyNameInput) companyNameInput.required = isCompany;
      if (!isCompany) {
        if (companyNameInput) companyNameInput.value = "";
      }
    }
    profileRadios.forEach((radio) => radio.addEventListener("change", updateProfileFields));

    function normalizedBrazilianPhone(value) {
      let digits = String(value || "").replace(/\D/g, "");
      if (digits.length === 10 || digits.length === 11) digits = "55" + digits;
      if (digits.length !== 12 && digits.length !== 13) {
        throw new Error("Informe um WhatsApp válido com DDD.");
      }
      return "+" + digits;
    }

    function isIOS() {
      return /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    }

    function isStandalone() {
      return window.matchMedia("(display-mode: standalone)").matches
        || window.navigator.standalone === true;
    }

    async function getAnonymousUser() {
      if (auth.currentUser) return auth.currentUser;
      const result = await signInAnonymously(auth);
      return result.user;
    }

    function notificationOptions(data = {}) {
      return {
        body: data.body || "Um novo acidente foi registrado na BR-365. Toque para conferir.",
        icon: "icones/icone-192.png",
        badge: "icones/icone-192.png",
        tag: data.tag || ("radar-br365-" + (data.id || Date.now())),
        renotify: false,
        data: { url: data.url || SITE_URL, accidentId: data.id || "" }
      };
    }

    async function registerDeviceAndSave(data, user, messaging, registration) {
      return new Promise((resolve, reject) => {
        let completed = false;
        let unsubscribe = () => {};

        const finish = (error, fid) => {
          if (completed) return;
          completed = true;
          clearTimeout(timer);
          unsubscribe();
          if (error) reject(error);
          else resolve(fid);
        };

        const timer = setTimeout(() => {
          finish(new Error("O Firebase não confirmou a inscrição deste celular. Tente novamente."));
        }, 30000);

        unsubscribe = onRegistered(messaging, async (fid) => {
          try {
            const batch = writeBatch(db);
            batch.set(doc(db, "contacts", user.uid), {
              name: data.name,
              phone: data.phone,
              profile: data.profile,
              companyName: data.companyName,
              contactConsent: true,
              updatedAt: serverTimestamp()
            });
            batch.set(doc(db, "pushSubscriptions", user.uid), {
              fid,
              platform: "web",
              pushConsent: true,
              updatedAt: serverTimestamp()
            });
            await batch.commit();
            finish(null, fid);
          } catch (error) {
            finish(error);
          }
        });

        register(messaging, {
          vapidKey: VAPID_PUBLIC_KEY,
          serviceWorkerRegistration: registration
        }).catch((error) => finish(error));
      });
    }

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;

      const pushConsent = document.getElementById("pushConsent");
      const contactConsent = document.getElementById("contactConsent");
      if (!pushConsent?.checked || !contactConsent?.checked) {
        setStatus("Marque as duas autorizações para concluir o cadastro.", true);
        return;
      }

      const originalText = enableButton.textContent;
      enableButton.disabled = true;
      enableButton.textContent = "Cadastrando...";

      try {
        if (!("Notification" in window) || !("serviceWorker" in navigator)) {
          throw new Error("Este navegador não oferece suporte a notificações push.");
        }
        if (isIOS() && !isStandalone()) {
          throw new Error("No iPhone, adicione primeiro o site à Tela de Início, abra pelo ícone e tente novamente.");
        }
        if (!(await isSupported())) {
          throw new Error("Este navegador não oferece suporte ao Firebase Cloud Messaging.");
        }

        const profile = selectedProfile();
        if (!profile) throw new Error("Selecione pessoa física ou pessoa jurídica.");

        const data = {
          name: document.getElementById("pushNome").value.trim(),
          phone: normalizedBrazilianPhone(document.getElementById("pushTelefone").value),
          profile,
          companyName: profile === "Pessoa jurídica" ? companyNameInput.value.trim() : ""
        };
        if (!data.name) throw new Error("Informe seu nome.");

        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          throw new Error("A permissão de notificações não foi concedida. Verifique as permissões do navegador.");
        }

        const user = await getAnonymousUser();
        const registration = await navigator.serviceWorker.ready;
        const messaging = getMessaging(app);

        await registerDeviceAndSave(data, user, messaging, registration);

        currentMessaging = messaging;
        currentRegistration = registration;

        if (!foregroundUnsubscribe) {
          foregroundUnsubscribe = onMessage(messaging, async (payload) => {
            const messageData = payload.data || {};
            await currentRegistration?.showNotification(
              messageData.title || "🚨 Novo acidente na BR-365",
              notificationOptions(messageData)
            );
          });
        }

        enableButton.textContent = "✅ Cadastro concluído";
        enableButton.disabled = true;
        disableButton.hidden = false;
        if (deleteContactButton) deleteContactButton.hidden = false;
        setStatus("Cadastro concluído! Seu WhatsApp foi incluído na base autorizada e este celular receberá os alertas automáticos.");
      } catch (error) {
        console.error("Falha ao ativar alertas do RADAR BR-365:", error);
        setStatus(error?.message || "Não foi possível concluir o cadastro. Tente novamente.", true);
        enableButton.textContent = originalText;
        enableButton.disabled = false;
      }
    });

    disableButton?.addEventListener("click", async () => {
      disableButton.disabled = true;
      try {
        const user = await getAnonymousUser();
        const messaging = currentMessaging || getMessaging(app);
        await unregister(messaging);
        await deleteDoc(doc(db, "pushSubscriptions", user.uid));
        enableButton.disabled = false;
        enableButton.textContent = "🔔 Cadastrar e ativar alertas neste celular";
        disableButton.hidden = true;
        setStatus("Os alertas foram desativados neste dispositivo. Seu contato continua salvo na base autorizada. Para excluir o contato também, use o botão de exclusão.");
      } catch (error) {
        console.error("Falha ao desativar alertas:", error);
        setStatus("Não foi possível desativar os alertas. Tente novamente.", true);
      } finally {
        disableButton.disabled = false;
      }
    });

    deleteContactButton?.addEventListener("click", async () => {
      const confirmed = window.confirm("Deseja excluir seu contato da base do RADAR BR-365 e cancelar os alertas deste dispositivo?");
      if (!confirmed) return;
      deleteContactButton.disabled = true;
      try {
        const user = await getAnonymousUser();
        const messaging = currentMessaging || getMessaging(app);
        await unregister(messaging).catch(() => {});
        const batch = writeBatch(db);
        batch.delete(doc(db, "pushSubscriptions", user.uid));
        batch.delete(doc(db, "contacts", user.uid));
        await batch.commit();
        enableButton.disabled = false;
        enableButton.textContent = "🔔 Cadastrar e ativar alertas neste celular";
        disableButton.hidden = true;
        deleteContactButton.hidden = true;
        setStatus("Seu contato foi excluído da base e os alertas deste dispositivo foram desativados.");
      } catch (error) {
        console.error("Falha ao excluir contato:", error);
        setStatus("Não foi possível excluir o cadastro. Tente novamente.", true);
      } finally {
        deleteContactButton.disabled = false;
      }
    });

    window.__radarPushModuleReady = true;
    setStatus("Formulário pronto. Preencha seus dados e autorizações para ativar os alertas.");
  } catch (error) {
    console.error("Erro ao carregar a integração do RADAR BR-365:", error);
    window.__radarPushModuleReady = false;
    setStatus("Falha ao carregar o Firebase: " + (error?.message || "erro desconhecido") + ". Seus dados não foram enviados.", true);
  }
})();
