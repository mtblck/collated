#!/bin/sh
# veraPDF, the reference PDF/A validator (#116), from Maven Central on first
# use (Java 11+ and Maven needed), then cached. The PDF/A tests use it when
# VERAPDF points here:  VERAPDF=scripts/verapdf.sh npm test
set -eu
VERSION=1.28.2
DIR="${XDG_CACHE_HOME:-$HOME/.cache}/collated-verapdf-$VERSION"
if [ ! -f "$DIR/ok" ]; then
  mkdir -p "$DIR"
  cat > "$DIR/pom.xml" <<POM
<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>
<groupId>local</groupId><artifactId>verapdf</artifactId><version>1</version>
<dependencies><dependency><groupId>org.verapdf.apps</groupId><artifactId>greenfield-apps</artifactId><version>$VERSION</version></dependency></dependencies>
</project>
POM
  mvn -q -f "$DIR/pom.xml" dependency:copy-dependencies -DoutputDirectory="$DIR/lib" >&2
  touch "$DIR/ok"
fi
exec java -cp "$DIR/lib/*" org.verapdf.apps.GreenfieldCliWrapper "$@"
