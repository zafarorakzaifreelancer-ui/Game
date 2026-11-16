# Forest Stick Survival 🌲🐕

An Android game. You walk through an endless forest with a stick and your dog **Buddy**,
fighting off wild animals and eating fruit to stay alive.

## How to get the APK
Every push to GitHub builds the APK automatically (GitHub Actions → **Build APK**).

* **Easiest:** open the repository's **Releases** page, find **"Forest Stick Survival (latest build)"**
  and download `ForestStickSurvival.apk` on your phone.
* Or open the **Actions** tab → latest **Build APK** run → download the `ForestStickSurvival-apk` artifact (a zip containing the APK).

Open the APK on your phone and allow "Install unknown apps" when Android asks.

## How to play
| Control | Touch | Keyboard (browser) |
|---|---|---|
| Move | drag on the left side of the screen | WASD / arrows |
| Hit with stick | **HIT** button (hold to keep swinging) | Space / J |
| Eat fruit | **EAT** button (shows up next to a fruit tree) | E |
| Pause | ⏸ top right / Back button | P / Esc |

* After **every 10 seconds of animal-free walking**, **1 or 2** animals appear, never more.
  Red arrows at the screen edge show where they come from.
* Animals behave differently:
  * **Fox**: runs away after you hit it.
  * **Wild Cat** and **Boar**: back off a few steps after each hit, then attack again. The boar also charges from a distance.
  * **Wolf** and **Bear**: never run away. Bears show up from level 3 and hit hard.
  * A red **!** over an animal means it's about to bite. Hit it or step away.
* **Buddy** follows you and bites any animal that comes close. If he gets hurt too much he rests for a few seconds, then comes back.
* Your health only comes back from **fruit** (apples, oranges, pears, plums). Stand next to a fruit tree and press **EAT**.
  Each tree has 3 fruits, and they grow back after a while. Buddy also gets some health back if he's close when you eat.
* The level goes up as you deal with more animals: they get a little stronger and pairs show up more often.

## Project layout
* `app/src/main/assets/` – the game itself (HTML5 canvas + JavaScript). You can also open `index.html` in a desktop browser to play.
* `app/src/main/java/.../MainActivity.java` – full-screen WebView that runs the game.
* `.github/workflows/build-apk.yml` – builds the APK and publishes it.

To build locally with the Android SDK: `./gradlew assembleRelease` (output: `app/build/outputs/apk/release/app-release.apk`).
The APK is signed with the debug key so it installs straight away. For a Play Store release, set up your own signing key.
