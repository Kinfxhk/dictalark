# Dictalark guide

[繁體中文版](guide.zh-Hant.md)

Dictalark (默書雲雀) is a free dictation and spelling practice page for families. It
runs in your browser, works offline after the first visit, and keeps your lists,
results and recordings **only on your device**. Automatic marking is only a guide; you
can change every mark.

## 1. Make a word list

1. Press **New list**. Give it a name and choose the subject: English, Chinese
   (Cantonese), Mandarin or Other. The subject sets the reading language (for example
   English (UK), Cantonese (Hong Kong), Mandarin (Traditional)); you can change it.
2. Type or paste the words or sentences under **Add words**, one per line, and press
   **Add**. Duplicates are marked so you can spot them.
3. Optional, per word:
   - **Also accept**: other answers that count as right, separated by `|` (for example
     `color` for `colour`).
   - **Read as**: what the voice should say instead of the word. Use it when a device
     voice reads a character with the wrong sound (for example a character with two
     readings): type a character or word with the right sound. Marking always uses the
     word itself.
   - **Language**: a different reading language for this word only (for example an
     English word in a Chinese list).
   - **Note**: a reminder for yourself (not read aloud).
   - **Record**: read the word yourself. Recordings stop by themselves after 30 seconds
     and are stored only in this browser. A recording is always used before a device
     voice, so record any word the device voice reads badly.

You can also **import** a CSV or TSV file (columns: word, other accepted answers, note,
language, read as; headers in English or Chinese are recognised) or a Dictalark JSON backup.
Files must be UTF-8. Use **Add sample lists** for three small example lists.

**Copy share link** puts the whole list inside a link (after `#`, the part browsers never
send to a server), for example to send to another parent. Opening the link shows the
list first; it is only added when you press **Add to my lists**. Recordings and results
are not included. Very long lists may be too long for a link; use a CSV file instead.

## 2. Practise

Open a list and press **Practise**. Choose how:

- **On paper**: the words are read aloud; the child writes them down; afterwards you
  mark each word right or wrong.
- **Type the answers**: the child types each answer and presses Enter. Dictalark marks
  the answers and shows the differences letter by letter (or character by character for
  Chinese). Capital letters, curly quotes, dash types, extra spaces, full-width letters
  and (for English) a final full stop are forgiven, and Dictalark says when it forgave
  something. Traditional and Simplified characters are **not** treated as the same
  (羣 is not 群).
- **Flash cards**: read aloud, reveal, and mark yourself.

Settings: readings per word, the pause between readings and between words, a countdown,
speed, shuffle (the same shuffle number gives the same order again), **start from item**,
hide the words while reading, and read punctuation aloud. During a dictation you can
pause, go back, read again, skip or finish. If you finish early, the results page offers
**Continue from item N** (with the same shuffle number, so the order is the same).

- **Passage mode** splits each item at punctuation (，。！？ , . ! ? and so on) and reads
  each part on its own, as many times as set. An item can hold up to 500 characters.
  Items with a recording are played whole.
- **Names for punctuation marks**: when punctuation is read aloud, you can replace the
  built-in names, one per line, for example `！ = 感歎號`.
- **Voices** (top menu) lists every voice your browser offers, with its language and
  whether it is on the device or online. Press **Try** to hear it and **Use for this
  language** to choose it. Online voices can only be tried when allowed in settings.

If the device has no voice for the language and the word has no recording, Dictalark
waits for you: read the word aloud yourself and press **I have read it aloud**.

## 3. Results and review

Save the results after marking. Wrong and unanswered words come back in **Today's
review** (a simple five-box schedule: wrong words today, right words after 1, 3, 7 and 14
days). You can print an **answer sheet**, an **answer key** or a **score sheet**.

## 4. Add a Cantonese (or other) voice to your device

Dictalark uses the voices installed on your device. It does not use online voices unless
you switch on **Allow online voices** (they send the words to your browser's speech
service). The steps below come from each vendor's own help pages; menus change between
versions.

- **Windows 10/11** — Settings → Time & language → Language & region → **Add a
  language** → choose _Chinese (Traditional, Hong Kong SAR)_ and tick **Text-to-speech**.
  Then Settings → Time & language → Speech to choose voices. Microsoft lists a Chinese
  (Hong Kong) voice. Source: [Microsoft Support: Download languages and voices](https://support.microsoft.com/en-us/topic/download-languages-and-voices-for-immersive-reader-read-mode-and-read-aloud-4c83a8d8-7486-42f7-8e46-2b0fdf753130).
- **Mac** — Apple menu → System Settings → Accessibility → **Read & Speak** → the
  button next to _System voice_ → choose the language and download a voice. Source:
  [Apple Support: Change the voice your Mac uses](https://support.apple.com/guide/mac-help/change-the-voice-your-mac-uses-to-speak-text-mchlp2290/mac).
  Whether a Cantonese voice is offered for your macOS version: **not verified**.
- **iPhone / iPad** — Settings → Accessibility → **Read & Speak** → Voices. Source:
  [Apple Support: Hear iPhone speak the screen](https://support.apple.com/guide/iphone/hear-iphone-speak-the-screen-selection-iph96b214f0/ios).
  Whether a Cantonese voice is offered for your iOS version: **not verified**.
- **Android** — Settings → Accessibility → **Text-to-speech output** → preferred engine
  settings → **Install voice data** → choose the language. Source:
  [Android Accessibility Help: Text-to-speech output](https://support.google.com/accessibility/android/answer/6006983).
  Which Cantonese voices your engine offers: **not verified**.

After installing a voice, reload Dictalark. The list page shows which voice will be
used. If only a different language or dialect is available (for example a Mandarin
voice for a Cantonese list), Dictalark says so instead of silently using it, and a
Mandarin list never silently uses a Cantonese voice. Recording the words yourself is
always the most reliable choice.

## 5. Your data

Everything stays in this browser on this device (IndexedDB). Dictalark makes no network
requests and has no accounts, ads or tracking. **Back up everything (JSON)** saves your
lists, results, review schedule and recordings to one file. Importing it adds everything
back (nothing on the device is overwritten). Backups from v0.1, which had no recordings,
can still be imported. **Delete all data on this device** removes everything Dictalark
stored.

Dictalark asks the browser to **keep** its storage, so that the browser does not clear it
by itself when the device runs low on space. The **Your data** box shows the answer:
kept, not kept, or not supported by this browser. Browsers decide this themselves.
After 20 changes, or 14 days after the first change since your last backup, a small
reminder offers **Back up now** or **Not now** (quiet for 7 days or 20 more changes). It
never appears during a dictation.

Clearing your browser's site data also deletes Dictalark's data, so keep a backup.
