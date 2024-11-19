<script>
    // You can add any necessary script here if needed
  </script>
  
  <div class="toolbar relative bg-primary-800 p-4">
    <h1 class="text-primary">My Toolbar</h1>
    <div class="gloss-effect absolute inset-0"></div>
  </div>
  
  <style>
    .gloss-effect {
      background: linear-gradient(to bottom, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0));
      pointer-events: none; /* Allows interaction with underlying elements */
      animation: shimmer 2s infinite linear; /* Optional shimmering effect */
      background-size: 200px; /* Adjust size for shimmer effect */
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
    }
  
    @keyframes shimmer {
      from {
        background-position: -200px;
      }
      to {
        background-position: 200px;
      }
    }
  </style>
  