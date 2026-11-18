pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
    // Declared here so the SDK builds on its own; keep in step with examples/android-app
    // and the kotlin-stdlib version in build.gradle.kts.
    plugins {
        id("com.android.library") version "8.2.0"
        id("org.jetbrains.kotlin.android") version "1.9.22"
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "savvagent-android-sdk"
