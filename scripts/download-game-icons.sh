#!/bin/bash
# Download game icons from Google Play Store
# Usage: bash scripts/download-game-icons.sh
# Output: public/img/games/<slug>.webp

DIR="public/img/games"
mkdir -p "$DIR"

UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

# Map: slug -> Google Play package ID
declare -A GAMES
GAMES[mobile-legends]="com.mobile.legends"
GAMES[free-fire]="com.dts.freefireth"
GAMES[pubg-mobile]="com.tencent.ig"
GAMES[genshin-impact]="com.miHoYo.GenshinImpact"
GAMES[valorant]="com.riotgames.league.valorant"
GAMES[honkai-star-rail]="com.HoYoverse.hkrpgoversea"
GAMES[honkai-impact-3]="com.miHoYo.bh3oversea"
GAMES[call-of-duty-mobile]="com.activision.callofduty.shooter"
GAMES[league-of-legends-wild-rift]="com.riotgames.league.wildrift"
GAMES[arena-of-valor]="com.ngame.allstar.eu"
GAMES[stumble-guys]="com.kitkagames.fallbuddies"
GAMES[fc-mobile]="com.ea.gp.fifamobile"
GAMES[lords-mobile]="com.igg.android.lordsmobile"
GAMES[point-blank]="com.zepetto.pointblankstrike"
GAMES[ragnarok-m-eternal-love]="com.gravity.romg"
GAMES[ragnarok-origin]="com.gravity.roo.gp.global"
GAMES[one-punch-man]="com.oasgames.ap.onepunchman_en"
GAMES[sausage-man]="com.xunyou.sausage"
GAMES[tower-of-fantasy]="com.levelinfinite.hotta.gp"
GAMES[state-of-survival]="com.kingsgroup.sos"
GAMES[speed-drifters]="com.garena.game.codm"
GAMES[asphalt-9]="com.gameloft.android.ANMP.GloftA9HM"
GAMES[au2-mobile]="com.boyaa.au2"
GAMES[be-the-king]="com.more.dagenern.gp"
GAMES[garena]="com.garena.game.kgid"
GAMES[heroes-evolved]="com.rsg.heroesevolved"
GAMES[honor-of-kings]="com.levelinfinite.sgameGlobal"
GAMES[mu-origin-3]="com.webzen.muorigin3.global"
GAMES[super-sus]="com.piyigame.suswolf"
GAMES[tom-and-jerry-chase]="com.netease.tjglobal"
GAMES[revelation-infinite-journey]="com.netease.rw.na"
GAMES[youtube]="com.google.android.youtube"

downloaded=0
failed=0

for slug in "${!GAMES[@]}"; do
  pkg="${GAMES[$slug]}"
  outfile="$DIR/$slug.jpg"

  if [ -f "$outfile" ]; then
    echo "SKIP $slug (exists)"
    continue
  fi

  echo -n "Downloading $slug ($pkg)... "

  # Fetch Play Store page, extract first icon URL
  icon_url=$(curl -sL -A "$UA" "https://play.google.com/store/apps/details?id=$pkg" | \
    grep -oE 'https://play-lh\.googleusercontent\.com/[^"'"'"']+' | \
    head -1)

  if [ -z "$icon_url" ]; then
    echo "FAIL (no icon URL found)"
    ((failed++))
    continue
  fi

  # Download icon at 512x512
  icon_url="${icon_url%%=*}=s512"

  if curl -sL -o "$outfile" "$icon_url"; then
    # Verify it's actually an image
    file_type=$(file -b --mime-type "$outfile" 2>/dev/null)
    if [[ "$file_type" == image/* ]]; then
      echo "OK ($(du -h "$outfile" | cut -f1))"
      ((downloaded++))
    else
      echo "FAIL (not an image: $file_type)"
      rm -f "$outfile"
      ((failed++))
    fi
  else
    echo "FAIL (download error)"
    ((failed++))
  fi

  sleep 0.5
done

echo ""
echo "Done: $downloaded downloaded, $failed failed"
echo "Total files: $(ls -1 "$DIR"/*.jpg 2>/dev/null | wc -l)"
