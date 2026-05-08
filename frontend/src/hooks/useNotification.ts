import { useCallback, useEffect, useState } from "react";

export function useNotification() {
  const [permissionGranted, setPermissionGranted] = useState(
    typeof Notification !== "undefined" && Notification.permission === "granted"
  );

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") setPermissionGranted(true);
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermissionGranted(result === "granted");
  }, []);

  const triggerNotification = useCallback(
    (text: string) => {
      if (permissionGranted) {
        new Notification("Your name was mentioned!", { body: text, icon: "/favicon.ico" });
      }
    },
    [permissionGranted]
  );

  return { permissionGranted, requestPermission, triggerNotification };
}
