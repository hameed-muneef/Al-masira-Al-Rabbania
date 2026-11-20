# Play Console — Permissions Justification (Al-Rabbaniyyun)

## 1) Exact alarm permission (SCHEDULE_EXACT_ALARM) – core functionality
Al-Rabbanyon is an Islamic app whose core function includes notifying users at the exact start time of each of the five daily Islamic prayers (adhan). Prayer times are calculated locally on the device from the user's location and device time zone. A delay of even a few minutes defeats the purpose of the feature, because users rely on the alert to perform the prayer within its time window. Inexact alarms (setAndAllowWhileIdle / inexact repeating) can be delayed by several minutes or more under Doze, which is not acceptable for this use case.

The app requests SCHEDULE_EXACT_ALARM (not USE_EXACT_ALARM). Before scheduling, it checks canScheduleExactAlarms() and, if the permission is not granted, shows an in-app explanation and a button that opens the system "Alarms & reminders" settings screen. If the user declines, the app continues to work with inexact reminders and clearly tells the user that prayer alerts may be delayed. Alarms are scheduled only for user-enabled prayers, and the user can turn them off at any time in the app settings.

## 2) Notification permission (POST_NOTIFICATIONS)
The app uses notifications to alert users at prayer times and, optionally, a few minutes before. The permission is not requested on first launch. The app first shows an explanation screen, and requests the permission only when the user taps "Enable prayer alerts". Each prayer's notification can be enabled or disabled individually. If the user denies the permission, the app does not ask repeatedly; it shows a button that opens the app's notification settings.

## 3) Boot receiver (RECEIVE_BOOT_COMPLETED)
Scheduled alarms are cleared when the device restarts. The app uses RECEIVE_BOOT_COMPLETED only to reschedule the user's already-enabled prayer alerts after reboot, so that the user does not miss alerts until the next time they open the app. No other work is performed at boot. Evidence: @capacitor/local-notifications ships `LocalNotificationRestoreReceiver` (android/src/main/AndroidManifest.xml) listening to BOOT_COMPLETED, LOCKED_BOOT_COMPLETED, QUICKBOOT_POWERON, with `directBootAware="true"`, which restores pending notifications automatically without launching the app.

Note on permission revocation: Android provides `ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED` so an app can reschedule after the user re-grants exact-alarm permission. This broadcast receiver is **not implemented** in our app or in the Capacitor plugin (verified by searching the plugin source: no receiver for that action). Therefore, if the user revokes then re-grants SCHEDULE_EXACT_ALARM without opening the app, alarms remain cancelled until the next app open (which triggers reschedule via the useEffect in App.tsx) or the user taps "إعادة جدولة" in settings. This is an accepted limitation; a WorkManager-based check was considered but rejected as too heavy and Doze-unfriendly.

## 4) Battery optimization
The app does NOT request REQUEST_IGNORE_BATTERY_OPTIMIZATIONS. Instead, it provides an optional button that opens ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS with an explanation, so the user can choose to disable battery optimization manually. This avoids Google Play policy issues while still guiding users who experience delayed alerts.

## 5) Video instructions for the Play Console declaration
Video (30–60 seconds) showing: (1) the app's prayer notification settings screen with prayer alerts enabled; (2) the in-app explanation and the system "Alarms & reminders" screen where the permission is granted; (3) a scheduled prayer alert firing at its exact time (device screen locked); (4) turning the alerts off in settings.

## 6) Sound file
Adhan sound: `android/app/src/main/res/raw/adhan.wav`. Android notification channel sound is locked after first creation (Android 8+); to change the sound later, create a NEW channel id (e.g. `al-rabbani-adhan-v2`) with a new `sound` and schedule with the new `channelId`. Recommended clip length ≤ 30s (Android notification sound limit).


## 7. Sound asset status (BLOCKER)
Adhan sound: android/app/src/main/res/raw/adhan.wav. This file does NOT currently exist in the repository. The project ships longer Adhan MP3s under public/sounds/adhan/ (68-279 s), which are too long for an Android notification channel sound (Android truncates notification sounds to ~30 s). A <=30 s Adhan clip must be supplied and placed at android/app/src/main/res/raw/adhan.wav (lowercase, alphanumeric + underscore only). Until then, the channel falls back to the system default sound (or silent, depending on OEM). Android notification channels lock their sound after first creation (Android 8+); to change the sound later, create a NEW channel id (e.g. al-rabbani-adhan-v2) with a new sound and schedule with the new channelId.


## 7. Adhan sound asset and playback architecture

### Asset present
android/app/src/main/res/raw/adhan.mp3 now exists (copied, byte-identical, from public/sounds/adhan/الملا.mp3: MP3, 16000 Hz, mono, ~158.8 s, 317576 bytes). No truncation or conversion was performed.

### Is there an official 30-second Android limit?
No. Android documentation does not state a hard maximum duration for notification channel sounds. The commonly cited 30 seconds is an iOS APNs limit, not an Android limit. In Android, notification sounds are played by the system RingtonePlayer service (com.android.systemui.media.RingtonePlayer) via IRingtonePlayer.playAsync(...), which plays the audio to completion (subject to the notification being dismissed, Doze, or OEM behavior). Evidence: NotificationAttentionHelper.playSound() calls player.playAsync(soundUri, ...) with no duration cap; Ringtone uses a MediaPlayer that plays the full file. No MAX_NOTIFICATION_SOUND_DURATION constant exists in the framework source reviewed.

### Can the existing long Adhan MP3s be used as notification channel sounds?
Technically yes - Android will play the full file (or until the notification is dismissed/Doze cuts it). Practically, using a 2-5 minute file as a notification sound is unreliable: dismissal stops playback, Doze may defer, OEMs may truncate, and it blocks other notification sounds for the entire duration. Therefore, for reliable full-Adhan playback (especially with screen locked / background), a Foreground Service with MediaPlayer is the recommended architecture, not a notification channel sound.

### Architecture recommendation
- Short alert (a few seconds): notification channel sound (current approach) - acceptable.
- Full Adhan (minutes, background, screen locked): Foreground Service (mediaPlayback type) + MediaPlayer + WakeLock + ongoing notification. Required for guaranteed full playback. This is the recommended path if the requirement is to play the complete Adhan.
- Until the Foreground Service is implemented, the channel sound (adhan.mp3) acts as a short alert and the in-app Adhan (when app is open) provides full playback.

### Channel sound lock (Android 8+)
Channels lock their sound after first creation. To change the sound later, create a NEW channel id (e.g. al-rabbani-adhan-v2) with a new sound and schedule with the new channelId. Do not silently change existing user notification preferences.
